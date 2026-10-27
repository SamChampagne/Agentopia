// string-width 7.2.0 (Sindre Sorhus, MIT) avec deux accélérations pour Claudetopia :
//  - texte ASCII imprimable (le cas de 95 % des caractères à l'écran) : la largeur est la longueur
//  - les autres textes sont mis en cache : Ink et wrap-ansi mesurent les mêmes textes à chaque image
// Le calcul lui-même est celui d'origine (original.js).
import stripAnsi from 'strip-ansi';
import original from './original.js';

const ASCII = /^[\x20-\x7E]*$/;
const cache = new Map();
const MAX = 50_000;

export default function stringWidth(string, options) {
	if (typeof string !== 'string' || string.length === 0) {
		return 0;
	}

	const defaut = !options || (options.ambiguousIsNarrow !== false && !options.countAnsiEscapeCodes);
	if (!defaut) {
		return original(string, options);
	}

	if (ASCII.test(string)) {
		return string.length;
	}

	let largeur = cache.get(string);
	if (largeur === undefined) {
		const sansCouleurs = string.includes('\u001B') ? stripAnsi(string) : string;
		largeur = ASCII.test(sansCouleurs) ? sansCouleurs.length : original(string);
		if (cache.size >= MAX) {
			cache.clear();
		}

		cache.set(string, largeur);
	}

	return largeur;
}
