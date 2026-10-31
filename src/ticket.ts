import type { Commande } from './commandes.js';
import { cleGitHub } from './compteGitHub.js';
import { Projet } from './projets.js';
import { lireDepot, appel } from './git.js';
import { jeton } from './jetons.js';
import { creerWorktree } from './worktrees.js';
import { lancerArrierePlan } from './agents.js';
import { bus, choisir, confirmer, saisir, tache } from './ui/bus.js';
import { c } from './theme.js';

// Une tâche à partir d'un ticket : lien GitHub (issue) ou Azure DevOps (work item), ou un numéro dans un projet.
// Agentopia lit le ticket, crée la branche (worktree à côté du dépôt) et y lance une session avec le ticket en consigne.

interface Ticket {
    numero: string;
    titre: string;
    description: string;
    lien: string;
    reference: string;        // ce qui lie la PR au ticket : « Closes #12 » (GitHub), « AB#123 » (Azure DevOps)
}

type Source = { type: 'github'; depot: string; numero: string } | { type: 'azure'; organisation: string; projet: string; numero: string };

// Le lien collé : une issue GitHub ou un work item Azure DevOps (dev.azure.com ou <org>.visualstudio.com)
export function lireLien(texte: string): Source | undefined {
    const github = /github\.com\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)/.exec(texte);
    if (github) return { type: 'github', depot: github[1], numero: github[2] };
    const azure = /dev\.azure\.com\/([^/\s]+)\/([^/\s]+)\/_workitems\/edit\/(\d+)/.exec(texte)
        ?? /([^/\s.]+)\.visualstudio\.com\/([^/\s]+)\/_workitems\/edit\/(\d+)/.exec(texte);
    if (azure) return { type: 'azure', organisation: azure[1], projet: decodeURIComponent(azure[2]), numero: azure[3] };
    return undefined;
}

// Le texte d'Azure DevOps est du HTML : on garde le texte et les sauts de ligne
const texteHtml = (html = '') => html.replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n').replace(/<li>/gi, '- ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();

export async function lireTicket(s: Source): Promise<Ticket | string> {
    if (s.type === 'github') {
        const cle = await cleGitHub();
        const r = await appel(`https://api.github.com/repos/${s.depot}/issues/${s.numero}`, {
            Accept: 'application/vnd.github+json', ...(cle ? { Authorization: `Bearer ${cle}` } : {}),
        });
        if (!r.ok) return r.statut === 404 ? `issue #${s.numero} introuvable dans ${s.depot}${cle ? '' : ' (dépôt privé ? ajoute un jeton GitHub : /jetons)'}` : `GitHub a répondu ${r.statut}`;
        return { numero: s.numero, titre: r.json.title, description: r.json.body ?? '', lien: r.json.html_url, reference: `Closes #${s.numero}` };
    }
    const cle = jeton('Azure DevOps');
    if (!cle) return 'pas de jeton Azure DevOps : ajoute-le avec /jetons';
    const r = await appel(`https://dev.azure.com/${s.organisation}/${encodeURIComponent(s.projet)}/_apis/wit/workitems/${s.numero}?api-version=7.1`,
        { Authorization: `Basic ${Buffer.from(':' + cle).toString('base64')}` });
    if (!r.ok) return r.statut === 404 ? `work item ${s.numero} introuvable` : `Azure DevOps a répondu ${r.statut}`;
    const f = r.json.fields ?? {};
    const description = [texteHtml(f['System.Description']), texteHtml(f['Microsoft.VSTS.TCM.ReproSteps']), texteHtml(f['Microsoft.VSTS.Common.AcceptanceCriteria'])]
        .filter(Boolean).join('\n\n');
    return {
        numero: s.numero, titre: f['System.Title'] ?? `Work item ${s.numero}`, description,
        lien: `https://dev.azure.com/${s.organisation}/${encodeURIComponent(s.projet)}/_workitems/edit/${s.numero}`, reference: `AB#${s.numero}`,
    };
}

// Le projet local qui correspond au dépôt du ticket (sinon on le demande)
async function projetDuTicket(s: Source, projets: Projet[]): Promise<Projet | undefined> {
    const depots = await Promise.all(projets.map((p) => lireDepot(p).catch(() => undefined)));
    const i = depots.findIndex((d) => d && (s.type === 'github'
        ? d.depot?.toLowerCase() === s.depot.toLowerCase()
        : d.api?.organisation?.toLowerCase() === s.organisation.toLowerCase() && d.api?.projet?.toLowerCase() === s.projet.toLowerCase()));
    return i >= 0 ? projets[i] : undefined;
}

// Un numéro seul (« 123 » ou « #123 ») : le ticket du dépôt du projet choisi
async function sourceDuProjet(p: Projet, numero: string): Promise<Source | undefined> {
    const d = await lireDepot(p).catch(() => undefined);
    if (d?.hebergeur === 'GitHub' && d.depot) return { type: 'github', depot: d.depot, numero };
    if (d?.hebergeur === 'Azure DevOps' && d.api?.organisation && d.api.projet) return { type: 'azure', organisation: d.api.organisation, projet: d.api.projet, numero };
    return undefined;
}

const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');

function consigne(t: Ticket): string {
    return `Tu travailles sur ce ticket : ${t.titre}
Lien : ${t.lien}

${t.description || '(pas de description)'}

Tu es dans une branche dédiée à ce ticket. Commence par explorer le code concerné et résume-moi ton plan en quelques lignes, puis fais le travail.
Quand c'est fini et vérifié (tests ou compilation) : commite avec un message clair qui contient « ${t.reference} », pousse la branche,
puis propose-moi d'ouvrir la pull request (titre, description, « ${t.reference} ») : ne l'ouvre pas sans ma confirmation.`;
}

export function commandesTicket(getProjets: () => Projet[]): Commande[] {
    return [{
        nom: 'ticket', args: '<lien|numéro>', groupe: 'Claude',
        description: 'Lancer une tâche depuis un ticket (issue GitHub, work item Azure DevOps) : branche + session avec le ticket',
        executer: async ({ reste }) => {
            const projets = getProjets();
            const entree = (reste || await saisir('Lien du ticket (GitHub, Azure DevOps) ou son numéro')).trim();
            let source = lireLien(entree);
            let projet = source && await tache('Recherche du projet du ticket', () => projetDuTicket(source!, projets));
            const choisirProjet = () => choisir('Dans quel projet ?', projets.map((p) => ({ label: p.nom, valeur: p, description: p.chemin })));
            if (!source) {
                const numero = /^#?(\d+)$/.exec(entree)?.[1];
                projet = await choisirProjet();
                source = numero ? await sourceDuProjet(projet, numero) : undefined;
            }
            if (!projet) projet = await choisirProjet();
            let ticket: Ticket | string;
            if (source) ticket = await tache('Lecture du ticket', () => lireTicket(source!));
            else {
                // Lien inconnu (Jira…) ou dépôt sans hébergeur reconnu : on prend le texte collé à la main
                const titre = await saisir('Titre du ticket (lien non reconnu : je ne peux pas le lire moi-même)');
                const description = await saisir('Description (colle-la ici)');
                ticket = { numero: /(\d+)\D*$/.exec(entree)?.[1] ?? '', titre, description, lien: entree, reference: entree };
            }
            if (typeof ticket === 'string') return void console.log(c.erreur(`✗ ${ticket}`));
            console.log(c.primaire(`Ticket ${ticket.numero ? `#${ticket.numero} ` : ''}· ${ticket.titre}`));
            if (ticket.description) console.log(c.discret(ticket.description.split('\n').slice(0, 6).map((l) => `  ${l}`).join('\n')));
            const branche = `ticket/${[ticket.numero, slug(ticket.titre)].filter(Boolean).join('-') || 'sans-titre'}`;
            if (!await confirmer(`Créer la branche ${branche} dans ${projet.nom} et y lancer Claude ?`)) return;
            const { dossier, erreur } = await tache('Création de la branche (worktree)', () => creerWorktree(projet!.chemin, branche));
            if (!dossier) return void console.log(c.erreur(`✗ ${erreur ?? 'impossible de créer la branche'}`));
            console.log(c.succes(`Branche ${branche} · ${dossier}`));
            const { id, sortie } = await tache('Démarrage de la session', () => lancerArrierePlan(dossier, `${ticket.numero ? `#${ticket.numero} ` : ''}${(ticket as Ticket).titre}`.slice(0, 60),
                consigne(ticket as Ticket)));
            if (!id) return void console.log(c.erreur(sortie.split('\n')[0] || 'Échec du lancement'));
            console.log(c.succes(`Session ${id} lancée sur le ticket · sa conversation s'ouvre à droite`));
            bus.emit('selectionner', id);
        },
    }];
}
