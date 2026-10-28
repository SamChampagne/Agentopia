// Garde-fou Claudetopia : hook PreToolUse de Claude Code (installé par /garde-fou, dans ~/.claude/settings.json).
// Avant chaque commande Bash d'une session, si elle pousse sur une branche protégée ou se connecte à un serveur
// marqué « prod », Claude doit te demander la permission (la session passe en « bloquée » dans Claudetopia).
// Volontairement autonome (aucun import du CLI) : il tourne avant chaque commande, il doit être rapide.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

const lire = (f) => {
    try {
        return JSON.parse(fs.readFileSync(f, 'utf-8'));
    } catch {
        return undefined;
    }
};

// Les hôtes visés par ssh / scp / sftp / rsync dans une commande
export function hotes(commande) {
    const trouves = [];
    for (const m of commande.matchAll(/\b(ssh|scp|sftp|rsync)\s+([^|;&\n]*)/g)) {
        const jetons = m[2].split(/\s+/).filter(Boolean);
        for (let i = 0; i < jetons.length; i++) {
            const j = jetons[i].replace(/^['"]|['"]$/g, '');
            if (j.startsWith('-')) {
                if (/^-[iopFlJPLRDwSWbcEeQm]$/.test(j)) i++;   // options suivies d'une valeur
                continue;
            }
            if (m[1] === 'ssh' || m[1] === 'sftp') {
                trouves.push(j.replace(/^.*@/, '').replace(/:.*$/, '').toLowerCase());
                break;
            }
            const distant = /^(?:[^@\s]+@)?([a-zA-Z0-9._-]{2,}):/.exec(j);
            if (distant) trouves.push(distant[1].toLowerCase());
        }
    }
    return trouves;
}

// La branche visée par un « git push » : celle de la refspec, sinon la branche courante
export function branchesPoussees(commande, cwd) {
    const branches = [];
    for (const m of commande.matchAll(/\bgit\b((?:\s+-C\s+\S+|\s+-c\s+\S+)*)\s+push\b([^|;&\n]*)/g)) {
        const args = m[2].split(/\s+/).filter((a) => a && !a.startsWith('-'));
        const refspecs = args.slice(1);
        if (refspecs.length) refspecs.forEach((r) => branches.push(r.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, '')));
        else {
            const dossier = /-C\s+(\S+)/.exec(m[1])?.[1]?.replace(/^['"]|['"]$/g, '');
            const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dossier ? path.resolve(cwd, dossier) : cwd, encoding: 'utf-8', timeout: 3000 });
            if (r.stdout?.trim()) branches.push(r.stdout.trim());
        }
    }
    return branches;
}

export function verifier(commande, cwd, garde) {
    const raisons = [];
    const protegees = new Set((garde.branches ?? []).map((b) => b.toLowerCase()));
    for (const b of branchesPoussees(commande, cwd)) if (protegees.has(b.toLowerCase())) raisons.push(`push sur la branche protégée « ${b} »`);
    const prod = new Set((garde.serveurs ?? []).map((s) => s.toLowerCase()));
    for (const h of hotes(commande)) if (prod.has(h)) raisons.push(`connexion au serveur de prod « ${h} »`);
    return raisons;
}

// Lancé comme hook (et pas importé par les tests ou par /garde-fou)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let entree = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (d) => (entree += d));
    process.stdin.on('end', () => {
        try {
            const e = JSON.parse(entree);
            const commande = e.tool_input?.command;
            const garde = lire(path.join(os.homedir(), '.claudetopia.json'))?.gardeFou;
            if (e.tool_name !== 'Bash' || typeof commande !== 'string' || !garde) return;
            const raisons = verifier(commande, e.cwd || process.cwd(), garde);
            if (!raisons.length) return;
            process.stdout.write(JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'ask',
                    permissionDecisionReason: `Garde-fou Claudetopia : ${raisons.join(', ')}. Confirme seulement si c'est voulu.`,
                },
            }));
        } catch {
            // en cas de doute, on ne bloque rien : le garde-fou ne doit jamais casser une session
        }
    });
}
