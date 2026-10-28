// Accélère le rendu d'Ink (lancé après npm install) : à chaque image, Ink redécoupe chaque ligne de l'écran
// en caractères colorés et recrée un style chalk pour chaque couleur. Les deux sont gardés en mémoire ici.
// Sans effet si déjà appliqué ; s'arrête en erreur si une nouvelle version d'Ink ne ressemble plus à ce qu'on attend.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const INK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'ink', 'build');
const MARQUE = '// Claudetopia :';

function patcher(fichier, remplacements) {
    const chemin = path.join(INK, fichier);
    let texte = fs.readFileSync(chemin, 'utf-8');
    if (texte.includes(MARQUE)) return;
    for (const [avant, apres] of remplacements) {
        if (!texte.includes(avant)) throw new Error(`patch-ink : « ${avant.trim().split('\n')[0]} » introuvable dans ink/build/${fichier} (version d'Ink changée ?)`);
        texte = texte.replace(avant, apres);
    }
    fs.writeFileSync(chemin, texte, 'utf-8');
    console.log(`patch-ink : ink/build/${fichier} accéléré`);
}

// Les caractères d'une ligne ne sont que lus ensuite : on peut réutiliser ceux d'une ligne identique
patcher('output.js', [
    ["} from '@alcalzone/ansi-tokenize';\n", `} from '@alcalzone/ansi-tokenize';
${MARQUE} découpage gardé par texte de ligne (d'une image à l'autre, presque toutes les lignes sont identiques)
const caracteresConnus = new Map();
const caracteresDe = (line) => {
    let caracteres = caracteresConnus.get(line);
    if (!caracteres) {
        if (caracteresConnus.size > 4000) caracteresConnus.clear();
        caracteres = styledCharsFromTokens(tokenize(line));
        caracteresConnus.set(line, caracteres);
    }
    return caracteres;
};
`],
    ['const characters = styledCharsFromTokens(tokenize(line));', 'const characters = caracteresDe(line);'],
]);

patcher('colorize.js', [
    ["const isNamedColor = (color) => {", `${MARQUE} un style chalk par couleur, créé une seule fois
const stylesHex = new Map();
const styleHex = (color, fond) => {
    const cle = (fond ? 'b' : 'f') + color;
    let style = stylesHex.get(cle);
    if (!style) {
        style = fond ? chalk.bgHex(color) : chalk.hex(color);
        stylesHex.set(cle, style);
    }
    return style;
};
const isNamedColor = (color) => {`],
    [`        return type === 'foreground'
            ? chalk.hex(color)(str)
            : chalk.bgHex(color)(str);`, `        return styleHex(color, type !== 'foreground')(str);`],
]);
