import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import MarkdownRender from 'markstream-react';

declare const __MARKSTREAM_CSS__: string;

export function getMarkstreamCss(): string {
    if (typeof __MARKSTREAM_CSS__ !== 'undefined') {
        return __MARKSTREAM_CSS__;
    }
    return '';
}

export interface StreamingMarkdownHandle {
    update: (content: string, final?: boolean) => void;
    destroy: () => void;
}

/**
 * 挂载 markstream-react 流式渲染器到指定 DOM 容器
 */
export function mountStreamingMarkdown(
    container: HTMLElement,
    initialContent: string = '',
    initialFinal: boolean = false
): StreamingMarkdownHandle {
    const root: Root = createRoot(container);

    const render = (text: string, isFinal: boolean) => {
        root.render(
            React.createElement(MarkdownRender, {
                content: text,
                final: isFinal,
                typewriter: !isFinal,
                fade: true,
                smoothStreaming: true,
                customHtmlTags: ['think', 'thinking']
            })
        );
    };

    render(initialContent, initialFinal);

    return {
        update: (content: string, final: boolean = false) => {
            render(content, final);
        },
        destroy: () => {
            try {
                root.unmount();
            } catch (e) { }
        }
    };
}

/**
 * 静态渲染完整 Markdown 文本
 */
export function renderStaticMarkdown(container: HTMLElement, content: string): void {
    const root: Root = createRoot(container);
    root.render(
        React.createElement(MarkdownRender, {
            content,
            final: true,
            typewriter: false,
            fade: false
        })
    );
}
