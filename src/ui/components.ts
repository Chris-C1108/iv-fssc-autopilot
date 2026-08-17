import { MENU_DICTIONARY } from '../config/constants';

export function renderAccountOptionsHTML(selectedVal: string = '03561d1db6a345af7f1906ec05cc0000'): string {
    return MENU_DICTIONARY.accounts.map(opt =>
        `<option value="${opt.value}" ${opt.value === selectedVal ? 'selected' : ''}>${opt.name}</option>`
    ).join('');
}

export function renderCostCenterOptionsHTML(selectedVal: string = '0356194b8b3de1653e55bb00bc610000'): string {
    return MENU_DICTIONARY.costCenters.map(opt =>
        `<option value="${opt.value}" ${opt.value === selectedVal ? 'selected' : ''}>${opt.name}</option>`
    ).join('');
}

export function renderKhfdOptionsHTML(selectedVal: string = '6b8ff07f9ebe11e88b7247d35c1e5077'): string {
    return MENU_DICTIONARY.khfd.map(opt =>
        `<option value="${opt.value}" ${opt.value === selectedVal ? 'selected' : ''}>${opt.name}</option>`
    ).join('');
}
