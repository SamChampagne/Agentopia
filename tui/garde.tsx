import { Component } from 'react';
import { GRAS } from './style.ts';
import { fond } from '../dist/theme.js';

// Une vue qui plante pendant son affichage ne doit pas laisser l'écran vide sans explication :
// on montre l'erreur à sa place (et dans le journal), Échap revient comme d'habitude
export class Garde extends Component<{ nom: string; children: any }, { erreur?: Error }> {
    state: { erreur?: Error } = {};
    static getDerivedStateFromError(erreur: Error) {
        return { erreur };
    }
    componentDidCatch(erreur: Error) {
        console.log(`✕ ${this.props.nom} : ${erreur.message}\n${(erreur.stack ?? '').split('\n').slice(1, 6).join('\n')}`);
    }
    render() {
        if (!this.state.erreur) return this.props.children;
        return (
            <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingTop={1}>
                <text fg="#f87171" attributes={GRAS}>{`✕ ${this.props.nom} n'a pas pu s'afficher`}</text>
                <text fg="#f87171" wrapMode="word">{this.state.erreur.message}</text>
                <text> </text>
                <text fg={fond.discret}>Le détail est dans le journal (/sorties) · Échap pour revenir</text>
            </box>
        );
    }
}
