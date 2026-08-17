import { apiRequest } from '../utils/http';
import { GlobalState, OptionItem } from '../types/state';

export async function searchDimProjectApi(
    keyword: string,
    state: GlobalState
): Promise<OptionItem[]> {
    const payload = {
        dimObjectId: '6b8ce3199ebe11e88b72a97a1dba5a21',
        isParentId: false,
        isShowDisable: false,
        searchInfo: keyword.trim(),
        isFastShow: true,
        isShowCode: false,
        isShowRootNode: false,
        isSynchronize: false,
        permDataScope: 'BILL_ENTRY',
        loginUserId: state.applicantId,
        isUseSecurityFormal: false
    };

    const res = await apiRequest('/fssc/dim/dimObject/getDimObjectAccessTree', 'POST', payload, state);
    const results: OptionItem[] = [];
    if (res.success && res.data && Array.isArray(res.data)) {
        const traverse = (nodes: any[]) => {
            nodes.forEach(node => {
                if (node.data) {
                    const d = node.data;
                    if (d.objectId && d.name) {
                        results.push({
                            id: d.objectId,
                            value: d.objectId,
                            code: d.code || '',
                            name: d.name,
                            title: d.externalSysAttr && d.externalSysAttr.NAME ? d.externalSysAttr.NAME : d.name
                        });
                    }
                }
                if (node.children && node.children.length > 0) {
                    traverse(node.children);
                }
            });
        };
        traverse(res.data);
    }
    return results;
}
