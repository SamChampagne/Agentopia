// The GitHub runner supplies the current owner after a native transfer.
export function depotPublication(environment = process.env) {
    if (environment.GITHUB_ACTIONS === 'true' && environment.GITHUB_REPOSITORY_ID !== '1436267735')
        throw new Error('Publication depuis un autre dépôt refusée');
    const repository = environment.GITHUB_REPOSITORY ?? 'SamChampagne/Agentopia';
    const canonical = ['SamChampagne/Agentopia', 'Intebec/Agentopia'].find(value => value.toLowerCase() === repository.toLowerCase());
    if (!canonical) throw new Error('Propriétaire de publication non autorisé');
    return canonical;
}
