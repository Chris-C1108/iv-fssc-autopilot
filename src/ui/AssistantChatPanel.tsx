import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import MarkdownRender from 'markstream-react';

export interface ChatAttachment {
    id: string;
    name: string;
    type: 'image' | 'file';
    size?: number;
    mimeType?: string;
    dataUrl?: string;
}

export interface ThinkingData {
    content: string;
    status: 'thinking' | 'done';
    durationMs?: number;
    isExpanded?: boolean;
}

export interface ChatToolCall {
    id: string;
    name: string;
    title: string;
    icon?: string;
    status: 'running' | 'done' | 'error';
    progress?: string;
    input?: any;
    output?: any;
    isExpanded?: boolean;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    time?: string;
    attachments?: ChatAttachment[];
    expenseContext?: { count: number; totalAmount: number };
    thinking?: ThinkingData;
    toolCalls?: ChatToolCall[];
    isStreaming?: boolean;
}

export interface ChatSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ChatMessage[];
}

export interface AiSkillItem {
    id: string;
    command: string;
    name: string;
    icon: string;
    summary: string;
    hintTitle: string;
    hintText: string;
    actionText?: string;
    actionId?: string;
    promptTemplate: (count: number, projectName: string, employeeName: string) => string;
}

interface AssistantChatPanelProps {
    sessions: ChatSession[];
    currentSessionId: string;
    onSelectSession: (id: string) => void;
    onNewSession: () => void;
    onDeleteSession: (id: string) => void;
    onSendMessage: (text: string, attachments: ChatAttachment[]) => Promise<void> | void;
    onApplySkill?: (skillId: string) => void;
    onSuggestionClick?: (key: 'infer' | 'itinerary' | 'autopilot-plan' | 'dashboard') => void;
    selectedExpenseCount: number;
    selectedExpenseAmount: number;
    attachedExpenseContextEnabled: boolean;
    onToggleExpenseContext: (enabled: boolean) => void;
    employeeName: string;
    isExecuting?: boolean;
    onClose?: () => void;
    skills: AiSkillItem[];
    activeSkillId: string | null;
    onDismissSkill: () => void;
    onCopyPromptTemplate?: () => void;
    selectedModel?: string;
    onSelectModel?: (model: string) => void;
}

/**
 * 1. ThinkingAccordion: 思考链手风琴折叠组件 (assistant-ui 标准范式)
 */
export const ThinkingAccordion: React.FC<{
    thinking: ThinkingData;
    onToggle?: () => void;
}> = ({ thinking, onToggle }) => {
    const [localExpanded, setLocalExpanded] = useState(thinking.isExpanded ?? false);
    const isExpanded = thinking.isExpanded !== undefined ? thinking.isExpanded : localExpanded;

    const handleToggle = () => {
        if (onToggle) {
            onToggle();
        } else {
            setLocalExpanded(!isExpanded);
        }
    };

    const isThinking = thinking.status === 'thinking';
    const durationSec = thinking.durationMs ? (thinking.durationMs / 1000).toFixed(1) : null;

    return (
        <div className={`aui-thinking-accordion ${isExpanded ? 'is-expanded' : ''}`}>
            <div className="aui-thinking-header" onClick={handleToggle}>
                <div className="aui-thinking-title-wrap">
                    <span className={`aui-thinking-sparkle ${isThinking ? 'is-pulsing' : ''}`}>
                        {isThinking ? '✦' : '🧠'}
                    </span>
                    <span>
                        {isThinking ? 'AI 正在深度思考规划...' : '已完成深度思考'}
                    </span>
                    {durationSec && !isThinking && (
                        <span className="aui-thinking-duration">耗时 {durationSec}s</span>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={`aui-thinking-chevron ${isExpanded ? 'is-expanded' : ''}`}>▾</span>
                </div>
            </div>
            {isExpanded && (
                <div className="aui-thinking-body">
                    {thinking.content || '思考过程正在流式生成中...'}
                </div>
            )}
        </div>
    );
};

/**
 * 2. ToolCallCard: 结构化工具调用卡片 (assistant-ui 标准组件)
 */
export const ToolCallCard: React.FC<{
    toolCall: ChatToolCall;
    onToggle?: () => void;
}> = ({ toolCall, onToggle }) => {
    const [localExpanded, setLocalExpanded] = useState(toolCall.isExpanded ?? false);
    const isExpanded = toolCall.isExpanded !== undefined ? toolCall.isExpanded : localExpanded;

    const handleToggle = () => {
        if (onToggle) {
            onToggle();
        } else {
            setLocalExpanded(!isExpanded);
        }
    };

    return (
        <div className="aui-tool-card">
            <div className="aui-tool-card-header" onClick={handleToggle}>
                <div className="aui-tool-card-title-wrap">
                    <span>{toolCall.icon || '⚙️'}</span>
                    <span>{toolCall.title || toolCall.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`aui-tool-status-badge ${toolCall.status}`}>
                        {toolCall.status === 'running' && (
                            <>
                                <span className="aui-tool-spinner" />
                                <span>执行中</span>
                            </>
                        )}
                        {toolCall.status === 'done' && (
                            <>
                                <span>✓</span>
                                <span>完成</span>
                            </>
                        )}
                        {toolCall.status === 'error' && (
                            <>
                                <span>✕</span>
                                <span>异常</span>
                            </>
                        )}
                    </span>
                    <span className={`aui-thinking-chevron ${isExpanded ? 'is-expanded' : ''}`}>▾</span>
                </div>
            </div>

            {toolCall.progress && toolCall.status === 'running' && (
                <div className="aui-tool-progress-text">
                    <span className="aui-tool-spinner" />
                    <span>{toolCall.progress}</span>
                </div>
            )}

            {isExpanded && (
                <div className="aui-tool-details">
                    {toolCall.input && (
                        <div>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '2px', fontWeight: 600 }}>输入参数 (Inputs):</div>
                            <div className="aui-tool-code-block">
                                {typeof toolCall.input === 'string' ? toolCall.input : JSON.stringify(toolCall.input, null, 2)}
                            </div>
                        </div>
                    )}
                    {toolCall.output && (
                        <div style={{ marginTop: '4px' }}>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '2px', fontWeight: 600 }}>返回结果 (Outputs):</div>
                            <div className="aui-tool-code-block">
                                {typeof toolCall.output === 'string' ? toolCall.output : JSON.stringify(toolCall.output, null, 2)}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * 3. MarkdownContent: 真正渲染 Markdown 表格、加粗、行内代码与排期的富文本渲染器
 */
export const MarkdownContent: React.FC<{
    content: string;
    isStreaming?: boolean;
}> = ({ content, isStreaming = false }) => {
    if (!content) return null;

    return (
        <div className="aui-markdown">
            <MarkdownRender
                content={content}
                final={!isStreaming}
                typewriter={isStreaming}
                fade={true}
                smoothStreaming={true}
                customHtmlTags={['think', 'thinking']}
            />
        </div>
    );
};

/**
 * 4. AssistantThread: 对话流与空白欢迎态组件
 */
export const AssistantThread: React.FC<{
    messages: ChatMessage[];
    employeeName: string;
    onSuggestionClick?: (key: 'infer' | 'itinerary' | 'autopilot-plan' | 'dashboard') => void;
    onImagePreview?: (url: string) => void;
}> = ({ messages, employeeName, onSuggestionClick, onImagePreview }) => {
    const viewportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (viewportRef.current) {
            viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }
    }, [messages]);

    const shortName = employeeName ? employeeName.slice(0, 2) : '社员';

    if (messages.length === 0) {
        return (
            <div className="aui-thread-viewport" ref={viewportRef}>
                <div className="aui-empty-state">
                    <div className="aui-sparkle-logo">
                        <span className="sparkle-char">✦</span>
                    </div>
                    <div className="aui-empty-title">Ask away, {shortName}!</div>
                    <div className="aui-empty-subtitle">
                        元年云费控极速自动驾驶副驾已就绪。支持粘贴排期、智能对账、提取发票专属必填项与一键极速建单。
                    </div>

                    <div className="aui-suggestions-grid">
                        <div
                            className="aui-suggestion-card"
                            onClick={() => onSuggestionClick?.('infer')}
                        >
                            <span className="aui-suggestion-icon">🔮</span>
                            <div className="aui-suggestion-text">
                                <span className="title">智能推断已选费用必填项</span>
                                <span className="desc">基于发票 OCR 与票据链自动推导交通与住宿字段</span>
                            </div>
                        </div>

                        <div
                            className="aui-suggestion-card"
                            onClick={() => onSuggestionClick?.('itinerary')}
                        >
                            <span className="aui-suggestion-icon">📋</span>
                            <div className="aui-suggestion-text">
                                <span className="title">粘贴排期规划 Trip 行程</span>
                                <span className="desc">粘贴日程表格或备忘，由大模型深度推理规划 Trip 区间</span>
                            </div>
                        </div>

                        <div
                            className="aui-suggestion-card"
                            onClick={() => onSuggestionClick?.('autopilot-plan')}
                        >
                            <span className="aui-suggestion-icon">✨</span>
                            <div className="aui-suggestion-text">
                                <span className="title">全流程智能规划 (行程与日常)</span>
                                <span className="desc">一键聚类出差往返 Trip 与日常办公费用</span>
                            </div>
                        </div>

                        <div
                            className="aui-suggestion-card"
                            onClick={() => onSuggestionClick?.('dashboard')}
                        >
                            <span className="aui-suggestion-icon">🚀</span>
                            <div className="aui-suggestion-text">
                                <span className="title">决策复核与极速建单 (HITL)</span>
                                <span className="desc">全景决策看板，复核申请单 (SC) 与报销单 (BC/BJ)</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="aui-thread-viewport" ref={viewportRef}>
            {messages.map((msg) => {
                const isUser = msg.role === 'user';
                const timeStr = msg.time || new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

                return (
                    <div key={msg.id} className={`aui-message-row ${isUser ? 'user' : 'assistant'}`}>
                        <div className="aui-message-meta">
                            {isUser ? (
                                <>
                                    <span>{timeStr}</span>
                                    <span>社员</span>
                                </>
                            ) : (
                                <>
                                    <span style={{ color: '#2563eb', fontWeight: 600 }}>✦ AI 智能副驾</span>
                                    <span className="badge-model">gemini-3.8-flash</span>
                                    <span>{timeStr}</span>
                                </>
                            )}
                        </div>

                        {/* 费用上下文胶囊 */}
                        {isUser && msg.expenseContext && (
                            <div className="aui-bubble-context-chip">
                                <span>📎 关联费用: <strong>{msg.expenseContext.count}</strong> 笔 (¥{Number(msg.expenseContext.totalAmount || 0).toFixed(2)})</span>
                            </div>
                        )}

                        {/* 附件缩略卡片 */}
                        {msg.attachments && msg.attachments.length > 0 && (
                            <div className="aui-attachments-row">
                                {msg.attachments.map((att) => (
                                    <div
                                        key={att.id}
                                        className="aui-attachment-pill"
                                        style={{ cursor: att.type === 'image' && att.dataUrl ? 'pointer' : 'default' }}
                                        onClick={() => {
                                            if (att.type === 'image' && att.dataUrl && onImagePreview) {
                                                onImagePreview(att.dataUrl);
                                            }
                                        }}
                                        title={att.name}
                                    >
                                        <span>{att.type === 'image' ? '🖼️' : '📄'}</span>
                                        <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {att.name}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* 消息正文主体 */}
                        {isUser ? (
                            <div className="aui-bubble-user">
                                {msg.text}
                            </div>
                        ) : (
                            <div className="aui-bubble-assistant">
                                {/* Thinking Accordion 折叠手风琴 */}
                                {msg.thinking && (
                                    <ThinkingAccordion thinking={msg.thinking} />
                                )}

                                {/* Tool Call 结构化工具卡片 */}
                                {msg.toolCalls && msg.toolCalls.length > 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {msg.toolCalls.map((tool) => (
                                            <ToolCallCard key={tool.id} toolCall={tool} />
                                        ))}
                                    </div>
                                )}

                                {/* Markdown 消息正文 (表格、加粗、排期等) */}
                                {msg.text && (
                                    <MarkdownContent content={msg.text} isStreaming={msg.isStreaming} />
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

/**
 * 5. AssistantComposer: assistant-ui 标准复合输入框
 */
export const AssistantComposer: React.FC<{
    onSendMessage: (text: string, attachments: ChatAttachment[]) => void;
    selectedCount: number;
    selectedAmount: number;
    contextEnabled: boolean;
    onToggleContext: (enabled: boolean) => void;
    activeSkill: AiSkillItem | null;
    onDismissSkill: () => void;
    onCopyPromptTemplate?: () => void;
    skills: AiSkillItem[];
    onApplySkill: (skillId: string) => void;
    isExecuting?: boolean;
    selectedModel?: string;
    onSelectModel?: (model: string) => void;
}> = ({
    onSendMessage,
    selectedCount,
    selectedAmount,
    contextEnabled,
    onToggleContext,
    activeSkill,
    onDismissSkill,
    onCopyPromptTemplate,
    skills,
    onApplySkill,
    isExecuting = false,
    selectedModel = 'gemini-3.8-flash-low',
    onSelectModel
}) => {
    const [inputText, setInputText] = useState('');
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [skillMenuOpen, setSkillMenuOpen] = useState(false);
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashQuery, setSlashQuery] = useState('');
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
        }
    }, [inputText]);

    // Matching skills for slash menu
    const slashMatchingSkills = useMemo(() => {
        const q = slashQuery.trim().toLowerCase();
        if (!q) return skills;
        return skills.filter(s =>
            s.command.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q)
        );
    }, [skills, slashQuery]);

    const handleSend = () => {
        const text = inputText.trim();
        if (!text && attachments.length === 0) return;
        if (isExecuting) return;

        onSendMessage(text, attachments);
        setInputText('');
        setAttachments([]);
        setSlashMenuOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (slashMenuOpen && slashMatchingSkills.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSlashSelectedIndex((prev) => (prev + 1) % slashMatchingSkills.length);
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSlashSelectedIndex((prev) => (prev - 1 + slashMatchingSkills.length) % slashMatchingSkills.length);
                return;
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const selected = slashMatchingSkills[slashSelectedIndex];
                if (selected) {
                    setInputText((prev) => prev.replace(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/, ''));
                    setSlashMenuOpen(false);
                    onApplySkill(selected.id);
                }
                return;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setSlashMenuOpen(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setInputText(val);

        const slashMatch = val.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
        if (slashMatch) {
            setSlashMenuOpen(true);
            setSlashQuery(slashMatch[1].toLowerCase());
            setSlashSelectedIndex(0);
        } else if (slashMenuOpen) {
            setSlashMenuOpen(false);
        }
    };

    const handleFiles = (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const newAttachments: ChatAttachment[] = [];

        Array.from(files).forEach((file) => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const dataUrl = ev.target?.result as string;
                    setAttachments((prev) => [
                        ...prev,
                        {
                            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                            name: file.name,
                            type: 'image',
                            size: file.size,
                            mimeType: file.type,
                            dataUrl
                        }
                    ]);
                };
                reader.readAsDataURL(file);
            } else {
                newAttachments.push({
                    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    name: file.name,
                    type: 'file',
                    size: file.size,
                    mimeType: file.type
                });
            }
        });

        if (newAttachments.length > 0) {
            setAttachments((prev) => [...prev, ...newAttachments]);
        }
    };

    return (
        <div className="aui-composer-container">
            <div
                className={`aui-composer-card ${isDragOver ? 'is-dragover' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
                onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
                }}
            >
                {/* 顶部上下文胶囊与技能 Prompt 引导 */}
                {((contextEnabled && selectedCount > 0) || activeSkill) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                            {contextEnabled && selectedCount > 0 && (
                                <div className="aui-bubble-context-chip" style={{ margin: 0 }}>
                                    <span>📎 已选中 <strong>{selectedCount}</strong> 笔费用 (¥{selectedAmount.toFixed(2)})</span>
                                    <span
                                        style={{ cursor: 'pointer', marginLeft: '4px', color: '#94a3b8' }}
                                        onClick={() => onToggleContext(false)}
                                        title="移除本次输入关联的费用"
                                    >
                                        ✕
                                    </span>
                                </div>
                            )}
                            {activeSkill && (
                                <div
                                    className="aui-bubble-context-chip"
                                    style={{ margin: 0, background: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}
                                >
                                    <span>{activeSkill.icon} 技能: <strong>{activeSkill.name}</strong></span>
                                    <span
                                        style={{ cursor: 'pointer', marginLeft: '4px', color: '#b45309' }}
                                        onClick={onDismissSkill}
                                        title="退出技能"
                                    >
                                        ✕
                                    </span>
                                </div>
                            )}
                        </div>

                        {activeSkill && (
                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px', fontSize: '11px', color: '#475569' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                                    <span style={{ fontWeight: 600, color: '#1e293b' }}>💡 {activeSkill.hintTitle}</span>
                                    {activeSkill.actionText && (
                                        <button
                                            type="button"
                                            onClick={onCopyPromptTemplate}
                                            style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '2px 6px', fontSize: '10.5px', color: '#2563eb', cursor: 'pointer' }}
                                        >
                                            {activeSkill.actionText}
                                        </button>
                                    )}
                                </div>
                                <div style={{ fontSize: '10.5px', lineHeight: 1.5 }}>{activeSkill.hintText}</div>
                            </div>
                        )}
                    </div>
                )}

                {/* 附件列表卡片 */}
                {attachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {attachments.map((att) => (
                            <div key={att.id} className="aui-attachment-pill">
                                <span>{att.type === 'image' ? '🖼️' : '📄'}</span>
                                <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {att.name}
                                </span>
                                <span
                                    style={{ cursor: 'pointer', color: '#94a3b8', marginLeft: '3px' }}
                                    onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                                >
                                    ✕
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Slash Menu 浮层 */}
                {slashMenuOpen && slashMatchingSkills.length > 0 && (
                    <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginBottom: '8px', zIndex: 100, overflow: 'hidden' }}>
                        <div style={{ padding: '6px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: '#64748b' }}>
                            <span>副驾快捷技能 (Skills)</span>
                            <span>↑↓ 导航 · Tab/Enter 确认 · Esc 关闭</span>
                        </div>
                        <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                            {slashMatchingSkills.map((s, idx) => (
                                <div
                                    key={s.id}
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', cursor: 'pointer', background: idx === slashSelectedIndex ? '#eff6ff' : 'transparent' }}
                                    onClick={() => {
                                        setInputText((prev) => prev.replace(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/, ''));
                                        setSlashMenuOpen(false);
                                        onApplySkill(s.id);
                                    }}
                                >
                                    <span>{s.icon}</span>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#2563eb', fontSize: '11px' }}>{s.command}</span>
                                    <span style={{ fontWeight: 600, fontSize: '11.5px', color: '#1e293b' }}>{s.name}</span>
                                    <span style={{ fontSize: '10.5px', color: '#64748b', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.summary}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 文本输入框 */}
                <textarea
                    ref={textareaRef}
                    className="aui-composer-textarea"
                    placeholder="输入指令或向副驾提问（键入 '/' 唤出技能，支持拖拽发票/排期截图或附件）..."
                    rows={1}
                    value={inputText}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                />

                {/* Composer 工具栏 */}
                <div className="aui-composer-toolbar">
                    <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        multiple
                        accept="image/*,.pdf,.doc,.docx,.xlsx,.xls,.txt,.csv"
                        onChange={(e) => handleFiles(e.target.files)}
                    />

                    <div className="aui-toolbar-left">
                        <button
                            type="button"
                            className="aui-btn-tool"
                            onClick={() => fileInputRef.current?.click()}
                            title="添加发票图片、排期或附件文件"
                        >
                            <span>＋</span>
                        </button>

                        <div style={{ position: 'relative' }}>
                            <button
                                type="button"
                                className={`aui-btn-tool ${skillMenuOpen ? 'active' : ''}`}
                                onClick={() => setSkillMenuOpen(!skillMenuOpen)}
                                title="选择副驾快捷技能 (或在输入框键入 '/')"
                            >
                                <span>⚡ 技能</span>
                                <span style={{ fontSize: '8px', opacity: 0.7 }}>▾</span>
                            </button>

                            {skillMenuOpen && (
                                <div style={{ position: 'absolute', bottom: '100%', left: 0, width: '260px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginBottom: '8px', zIndex: 100, overflow: 'hidden' }}>
                                    <div style={{ padding: '6px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '10.5px', fontWeight: 600, color: '#475569' }}>
                                        选择副驾技能 (Skills)
                                    </div>
                                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                        {skills.map((s) => (
                                            <div
                                                key={s.id}
                                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                                                onClick={() => {
                                                    setSkillMenuOpen(false);
                                                    onApplySkill(s.id);
                                                }}
                                            >
                                                <span>{s.icon}</span>
                                                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#1e293b' }}>{s.name}</span>
                                                        <span style={{ fontSize: '10px', color: '#2563eb', fontFamily: 'monospace' }}>{s.command}</span>
                                                    </div>
                                                    <div style={{ fontSize: '10px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.summary}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {onSelectModel && (
                            <select
                                value={selectedModel}
                                onChange={(e) => onSelectModel(e.target.value)}
                                style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '10.5px', color: '#475569', padding: '3px 6px', outline: 'none' }}
                            >
                                <option value="gemini-3.8-flash-low">Gemini 3.8 Flash (极速)</option>
                                <option value="gemini-3.8-pro">Gemini 3.8 Pro (深度认知)</option>
                                <option value="local-rule-engine">本地规则引擎 (离线)</option>
                            </select>
                        )}
                    </div>

                    <button
                        type="button"
                        className="aui-btn-send"
                        onClick={handleSend}
                        disabled={isExecuting || (!inputText.trim() && attachments.length === 0)}
                        title="发送消息 (Enter)"
                    >
                        {isExecuting ? <span className="aui-tool-spinner" style={{ borderColor: '#fff', borderTopColor: 'transparent' }} /> : '▲'}
                    </button>
                </div>
            </div>
        </div>
    );
};

/**
 * 6. AssistantChatPanel: 主交互顶层组件，包含会话切换 Header、Thread 视口与 Composer
 */
export const AssistantChatPanel: React.FC<AssistantChatPanelProps> = ({
    sessions,
    currentSessionId,
    onSelectSession,
    onNewSession,
    onDeleteSession,
    onSendMessage,
    onApplySkill,
    onSuggestionClick,
    selectedExpenseCount,
    selectedExpenseAmount,
    attachedExpenseContextEnabled,
    onToggleExpenseContext,
    employeeName,
    isExecuting = false,
    onClose,
    skills,
    activeSkillId,
    onDismissSkill,
    onCopyPromptTemplate,
    selectedModel,
    onSelectModel
}) => {
    const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

    const currentSession = useMemo(() => {
        return sessions.find(s => s.id === currentSessionId) || sessions[0] || {
            id: 'session_init',
            title: 'Trip 智能规划与对账分析',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: []
        };
    }, [sessions, currentSessionId]);

    const activeSkill = useMemo(() => {
        return skills.find(s => s.id === activeSkillId) || null;
    }, [skills, activeSkillId]);

    return (
        <div className="aui-root">
            {/* 顶栏 Header: 标题 + 会话切换下拉 + 关闭按钮 */}
            <div className="yn-bem-ai-panel-header">
                <div className="yn-bem-ai-title-wrap">
                    <span className="yn-gemini-sparkle-icon">✦</span>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>AI 智能副驾</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                    <button
                        type="button"
                        className="yn-gemini-menu-trigger"
                        onClick={(e) => {
                            e.stopPropagation();
                            setHistoryMenuOpen(!historyMenuOpen);
                        }}
                        title="切换历史会话或新建对话"
                    >
                        <span>≡</span>
                        <span style={{ maxWidth: '96px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px' }}>
                            {currentSession.title || '会话'}
                        </span>
                        <span style={{ fontSize: '9px', color: '#94a3b8' }}>▾</span>
                    </button>

                    {historyMenuOpen && (
                        <div
                            className="yn-gemini-history-dropdown"
                            style={{ display: 'flex' }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div
                                className="yn-gemini-menu-item"
                                onClick={() => {
                                    setHistoryMenuOpen(false);
                                    onNewSession();
                                }}
                            >
                                <span>📝</span>
                                <span>开启新对话 (Start new chat)</span>
                            </div>
                            <div className="yn-gemini-menu-divider" />
                            <div className="yn-gemini-menu-header">最近会话</div>
                            <div className="yn-gemini-history-list">
                                {sessions.map((s) => (
                                    <div
                                        key={s.id}
                                        className={`yn-gemini-menu-item ${s.id === currentSession.id ? 'is-active' : ''}`}
                                        style={{ justifyContent: 'space-between' }}
                                        onClick={() => {
                                            setHistoryMenuOpen(false);
                                            onSelectSession(s.id);
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                            <span>💬</span>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {s.title || '未命名会话'}
                                            </span>
                                        </div>
                                        {sessions.length > 1 && (
                                            <span
                                                className="yn-gemini-session-del"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDeleteSession(s.id);
                                                }}
                                                title="删除会话"
                                            >
                                                ✕
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {onClose && (
                        <button
                            type="button"
                            className="yn-bem-close-x"
                            onClick={onClose}
                            title="收起 AI 助手"
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>

            {/* 对话消息视口 Thread Viewport */}
            <AssistantThread
                messages={currentSession.messages}
                employeeName={employeeName}
                onSuggestionClick={onSuggestionClick}
                onImagePreview={(url) => setPreviewImageUrl(url)}
            />

            {/* 底部复合输入卡片 Composer */}
            <AssistantComposer
                onSendMessage={onSendMessage}
                selectedCount={selectedExpenseCount}
                selectedAmount={selectedExpenseAmount}
                contextEnabled={attachedExpenseContextEnabled}
                onToggleContext={onToggleExpenseContext}
                activeSkill={activeSkill}
                onDismissSkill={onDismissSkill}
                onCopyPromptTemplate={onCopyPromptTemplate}
                skills={skills}
                onApplySkill={(sid) => onApplySkill?.(sid)}
                isExecuting={isExecuting}
                selectedModel={selectedModel}
                onSelectModel={onSelectModel}
            />

            {/* 图片 Lightbox 放大模态框 */}
            {previewImageUrl && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.75)',
                        backdropFilter: 'blur(4px)',
                        zIndex: 1000000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '24px'
                    }}
                    onClick={() => setPreviewImageUrl(null)}
                >
                    <img
                        src={previewImageUrl}
                        alt="Preview"
                        style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                    />
                    <button
                        type="button"
                        style={{ position: 'absolute', top: '20px', right: '20px', background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', borderRadius: '50%', width: '36px', height: '36px', fontSize: '18px', cursor: 'pointer' }}
                        onClick={() => setPreviewImageUrl(null)}
                    >
                        ✕
                    </button>
                </div>
            )}
        </div>
    );
};
