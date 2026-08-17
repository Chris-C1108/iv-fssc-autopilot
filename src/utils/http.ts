import { GlobalState } from '../types/state';

declare const GM_xmlhttpRequest: any;

export function getHeaders(state: GlobalState, isFormUrlEncoded = false, isMultipart = false): Record<string, string> {
    const headers: Record<string, string> = {
        'LoginToken': state.loginToken,
        'EcsToken': state.ecsToken,
        'UserOrigin': state.userOrigin || 'https://ync37.yuanian.com',
        'appid': state.appId || 'e3d5e4787ff911e88b1997bee3518b4d',
        'menuid': state.menuId || '11eedb8f8a31cd8f8a25f721e03d0caa',
        'Accept': '*/*'
    };
    if (state.eicds) headers['eicds'] = state.eicds;
    if (state.v) headers['v'] = state.v;

    if (isFormUrlEncoded) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    } else if (!isMultipart) {
        headers['Content-Type'] = 'application/json;charset=UTF-8';
    }
    return headers;
}

export async function apiRequest(
    url: string,
    method: string = 'POST',
    data: any = null,
    state: GlobalState,
    isFormUrlEncoded = false,
    isMultipart = false
): Promise<any> {
    if (!state.loginToken && !state.ecsToken) {
        const localTok = sessionStorage.getItem('LoginToken') || localStorage.getItem('LoginToken') || sessionStorage.getItem('token') || '';
        if (localTok) {
            state.loginToken = localTok;
            state.ecsToken = localTok;
        } else {
            throw new Error('未检测到登录 Token，请先在页面上刷新或操作以捕获 Token');
        }
    }
    const fullUrl = url.startsWith('http') ? url : `${state.userOrigin || 'https://ync37.yuanian.com'}${url}`;
    const headers = getHeaders(state, isFormUrlEncoded, isMultipart);

    let bodyStr: any = undefined;
    if (data) {
        if (isFormUrlEncoded || isMultipart) {
            bodyStr = data;
        } else {
            bodyStr = JSON.stringify(data);
        }
    }

    return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: method,
                url: fullUrl,
                headers: headers,
                data: bodyStr,
                onload: (response: any) => {
                    try {
                        const json = JSON.parse(response.responseText);
                        resolve(json);
                    } catch (e) {
                        resolve({ success: false, message: response.responseText || '解析响应失败' });
                    }
                },
                onerror: (err: any) => reject(err)
            });
        } else {
            fetch(fullUrl, {
                method: method,
                headers: headers,
                body: bodyStr
            })
                .then(r => r.json())
                .then(resolve)
                .catch(reject);
        }
    });
}
