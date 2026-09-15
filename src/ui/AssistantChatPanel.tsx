import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import MarkdownRender from 'markstream-react';
import { openWebMcpSettingsModal } from './webmcpSettingsModal';
import {
    getLlmConfig,
    saveLlmConfig,
    getDefaultModelsForProvider,
    LlmConfig,
    ModelOption
} from '../services/llmService';

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

export interface TripPlanConfirmationAction {
    type: 'APPLY_TRIP_PLANS';
    trips: any[];
    rawText?: string;
    applied?: boolean;
    appliedTime?: string;
}

export interface TravelReportConfirmationAction {
    type: 'APPLY_TRAVEL_REPORTS';
    reports: Array<{ tripIndex?: number; billId?: string; title: string; content: string; dest?: string }>;
    applied?: boolean;
    appliedTime?: string;
}

export type AssistantConfirmationAction = TripPlanConfirmationAction | TravelReportConfirmationAction;

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
    confirmationAction?: AssistantConfirmationAction;
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
    onApplyTripPlans?: (messageId: string, action: TripPlanConfirmationAction) => void;
    onApplyTravelReports?: (messageId: string, action: TravelReportConfirmationAction) => void;
    selectedExpenseCount: number;
    selectedExpenseAmount: number;
    attachedExpenseContextEnabled: boolean;
    onToggleExpenseContext: (enabled: boolean) => void;
    employeeName: string;
    isExecuting?: boolean;
    onClose?: () => void;
    onOpenSettings?: () => void;
    skills: AiSkillItem[];
    activeSkillId: string | null;
    onDismissSkill: () => void;
    onCopyPromptTemplate?: () => void;
    selectedModel?: string;
    onSelectModel?: (model: string) => void;
    llmConfig?: LlmConfig;
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
                fade={isStreaming}
                smoothStreaming={isStreaming ? 'auto' : false}
                batchRendering={isStreaming}
                deferNodesUntilVisible={false}
                viewportPriority={false}
                maxLiveNodes={0}
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
    onApplyTripPlans?: (messageId: string, action: TripPlanConfirmationAction) => void;
    onApplyTravelReports?: (messageId: string, action: TravelReportConfirmationAction) => void;
    isExecuting?: boolean;
}> = ({ messages, employeeName, onSuggestionClick, onImagePreview, onApplyTripPlans, onApplyTravelReports, isExecuting }) => {
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
                                <span className="title">报销单管理看板</span>
                                <span className="desc">以报销单为条目，统一管理申请单 (SC) 与报销单 (BC/BJ)</span>
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

                                {/* HITL 出差排期确认操作卡片 (人类在回路确认，绝不私自覆盖修改表格) */}
                                {msg.confirmationAction && msg.confirmationAction.type === 'APPLY_TRIP_PLANS' && (
                                    <div className={`aui-confirmation-card ${msg.confirmationAction.applied ? 'is-applied' : ''}`}>
                                        <div className="aui-confirmation-header">
                                            <div className="aui-confirmation-title">
                                                <span className="aui-confirmation-icon">{msg.confirmationAction.applied ? '✅' : '📋'}</span>
                                                <span className="aui-confirmation-title-text">
                                                    {msg.confirmationAction.applied ? '出差排期规划已生效' : '待确认：应用出差排期至表格 (HITL)'}
                                                </span>
                                            </div>
                                            <span className="aui-confirmation-badge">
                                                {msg.confirmationAction.trips.length} 轮 Trip
                                            </span>
                                        </div>
                                        <div className="aui-confirmation-desc">
                                            {msg.confirmationAction.applied ? (
                                                <>已将 AI 规划的 <strong>{msg.confirmationAction.trips.length}</strong> 轮出差往返 Trip 应用至费用明细表。{msg.confirmationAction.appliedTime ? `(确认时间: ${msg.confirmationAction.appliedTime})` : ''}</>
                                            ) : (
                                                <>AI 已完成排期深度认知解析并识别 <strong>{msg.confirmationAction.trips.length}</strong> 轮往返闭环。请复核上方排期推断表格，确认无误后点击下方按钮应用到当前表格并自动对齐发票必填项。</>
                                            )}
                                        </div>
                                        {!msg.confirmationAction.applied ? (
                                            <div className="aui-confirmation-actions">
                                                <button
                                                    type="button"
                                                    className="aui-confirmation-btn-primary"
                                                    disabled={isExecuting}
                                                    onClick={() => onApplyTripPlans?.(msg.id, msg.confirmationAction as TripPlanConfirmationAction)}
                                                >
                                                    ✓ 确认应用到表格并对齐字段 ({msg.confirmationAction.trips.length} 轮 Trip)
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="aui-confirmation-applied-note">
                                                <span>✓ 表格已按此排期完成时空分组</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* HITL 出差报告一键回填卡片 (人类在回路确认回填至单据) */}
                                {msg.confirmationAction && msg.confirmationAction.type === 'APPLY_TRAVEL_REPORTS' && (
                                    <div className={`aui-confirmation-card ${msg.confirmationAction.applied ? 'is-applied' : ''}`}>
                                        <div className="aui-confirmation-header">
                                            <div className="aui-confirmation-title">
                                                <span className="aui-confirmation-icon">{msg.confirmationAction.applied ? '✅' : '📝'}</span>
                                                <span className="aui-confirmation-title-text">
                                                    {msg.confirmationAction.applied ? '出差总结报告已回填至报销单' : '待确认：一键回填出差报告至报销单 (HITL)'}
                                                </span>
                                            </div>
                                            <span className="aui-confirmation-badge">
                                                {msg.confirmationAction.reports.length} 份出差报告
                                            </span>
                                        </div>
                                        <div className="aui-confirmation-desc">
                                            {msg.confirmationAction.applied ? (
                                                <>已将 AI 撰写的 <strong>{msg.confirmationAction.reports.length}</strong> 份出差工作总结报告成功回填至对应出差单的【出差报告】字段中。{msg.confirmationAction.appliedTime ? `(回填时间: ${msg.confirmationAction.appliedTime})` : ''}</>
                                            ) : (
                                                <>AI 已为您深度撰写 <strong>{msg.confirmationAction.reports.length}</strong> 份专业出差报告。请复核上方报告正文，确认无误后点击下方按钮，一键同步回填写入对应出差费用报销单 (BC) 的报告字段中。</>
                                            )}
                                        </div>
                                        {!msg.confirmationAction.applied ? (
                                            <div className="aui-confirmation-actions">
                                                <button
                                                    type="button"
                                                    className="aui-confirmation-btn-primary"
                                                    disabled={isExecuting}
                                                    onClick={() => onApplyTravelReports?.(msg.id, msg.confirmationAction as TravelReportConfirmationAction)}
                                                >
                                                    ✓ 确认将报告一键回填至对应报销单 ({msg.confirmationAction.reports.length} 份)
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="aui-confirmation-applied-note">
                                                <span>✓ 报销单管理看板中对应出差报告已更新就绪</span>
                                            </div>
                                        )}
                                    </div>
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
    onOpenSettings?: () => void;
    llmConfig?: LlmConfig;
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
    selectedModel = 'gemini-2.0-flash',
    onSelectModel,
    onOpenSettings,
    llmConfig
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

    // 动态计算已勾选启用的模型列表
    const enabledModels = useMemo(() => {
        const activeCfg = llmConfig || getLlmConfig();
        const rawModels = activeCfg?.models && activeCfg.models.length > 0
            ? activeCfg.models
            : getDefaultModelsForProvider(activeCfg?.provider || 'gemini');

        const list = rawModels.filter(m => m.enabled);
        if (list.length === 0) {
            const cur = activeCfg?.model || selectedModel || 'gemini-2.0-flash';
            list.push({ id: cur, name: cur, enabled: true });
        }
        if (selectedModel && !list.some(m => m.id === selectedModel)) {
            const found = rawModels.find(m => m.id === selectedModel);
            if (found) {
                list.unshift(found);
            } else {
                list.unshift({ id: selectedModel, name: selectedModel, enabled: true });
            }
        }
        return list;
    }, [llmConfig, selectedModel]);

    // Auto-resize textarea (async rAF to eliminate forced synchronous reflow)
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        const rafId = requestAnimationFrame(() => {
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
        });
        return () => cancelAnimationFrame(rafId);
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
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '__manage_models__') {
                                        onOpenSettings?.();
                                        return;
                                    }
                                    onSelectModel(val);
                                }}
                                title="切换当前生效模型 (可在设置中自动识别与勾选展示的模型)"
                                style={{
                                    background: '#ffffff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '8px',
                                    fontSize: '11px',
                                    fontWeight: 500,
                                    color: '#334155',
                                    padding: '3px 6px',
                                    outline: 'none',
                                    cursor: 'pointer',
                                    maxWidth: '180px',
                                    height: '24px'
                                }}
                            >
                                {enabledModels.map(m => (
                                    <option key={m.id} value={m.id}>
                                        {m.isReasoning ? '🧠 ' : (m.isVision ? '👁️ ' : '')}{m.name || m.id}
                                    </option>
                                ))}
                                <option disabled style={{ color: '#cbd5e1' }}>──────────</option>
                                <option value="__manage_models__">⚙️ 探测与配置更多模型...</option>
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
    onApplyTripPlans,
    onApplyTravelReports,
    selectedExpenseCount,
    selectedExpenseAmount,
    attachedExpenseContextEnabled,
    onToggleExpenseContext,
    employeeName,
    isExecuting = false,
    onClose,
    onOpenSettings,
    skills,
    activeSkillId,
    onDismissSkill,
    onCopyPromptTemplate,
    selectedModel,
    onSelectModel,
    llmConfig: llmConfigProp
}) => {
    const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
    const [llmConfig, setLlmConfig] = useState<LlmConfig>(() => llmConfigProp || getLlmConfig());

    // 保持与外部 llmConfigProp 变更、selectedModel 变更及 localStorage 同步
    useEffect(() => {
        if (llmConfigProp) {
            setLlmConfig(llmConfigProp);
        } else {
            setLlmConfig(getLlmConfig());
        }
    }, [llmConfigProp, selectedModel]);

    // 监听全局配置变更事件，即使 React 没有重新传参也能毫秒级无感响应
    useEffect(() => {
        const handleConfigChange = (e: any) => {
            const updated = e?.detail || getLlmConfig();
            setLlmConfig(updated);
        };
        window.addEventListener('autopilot:llm_config_changed', handleConfigChange);
        return () => window.removeEventListener('autopilot:llm_config_changed', handleConfigChange);
    }, []);

    // 点击外部区域自动收起历史会话浮层
    useEffect(() => {
        if (!historyMenuOpen) return;
        const handleOutsideClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.yn-gemini-history-dropdown') && !target.closest('.aui-history-trigger-btn')) {
                setHistoryMenuOpen(false);
            }
        };
        document.addEventListener('click', handleOutsideClick);
        return () => document.removeEventListener('click', handleOutsideClick);
    }, [historyMenuOpen]);

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

    const handleOpenSettings = useCallback(() => {
        setHistoryMenuOpen(false);
        if (onOpenSettings) {
            onOpenSettings();
        } else {
            openWebMcpSettingsModal((savedCfg) => {
                setLlmConfig(savedCfg);
                onSelectModel?.(savedCfg.model);
            });
        }
    }, [onOpenSettings, onSelectModel]);

    return (
        <div className="aui-root">
            {/* 顶栏 Header: 标题 + 右上角 4 按钮 (新会话、历史会话、设置、关闭) */}
            <div className="yn-bem-ai-panel-header">
                <div className="yn-bem-ai-title-wrap">
                    <span className="yn-gemini-sparkle-icon">✦</span>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>AI 智能副驾</span>
                    {currentSession.title && (
                        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={currentSession.title}>
                            · {currentSession.title}
                        </span>
                    )}
                </div>

                <div className="aui-header-actions">
                    {/* 1. 新会话按钮 */}
                    <button
                        type="button"
                        className="aui-header-action-btn"
                        onClick={() => {
                            setHistoryMenuOpen(false);
                            onNewSession();
                        }}
                        title="开启新会话 (Start new chat)"
                        aria-label="新会话"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none">
                            <g fill="transparent" stroke="currentColor" strokeLinejoin="round" strokeWidth="2">
                                <path d="M11 4H7.2c-1.12 0-1.68 0-2.108.218-.376.192-.682.498-.874.874C4 5.52 4 6.08 4 7.2v9.6c0 1.12 0 1.68.218 2.108.192.376.498.682.874.874C5.52 20 6.08 20 7.2 20h9.6c1.12 0 1.68 0 2.108-.218.376-.192.682-.498.874-.874C20 18.48 20 17.92 20 16.8V13" strokeLinecap="round" />
                                <path d="M9 15v-2.586c0-.265.105-.52.293-.707l8.043-8.043c.78-.78 2.047-.78 2.828 0l.172.172c.78.78.78 2.047 0 2.828l-8.043 8.043c-.188.188-.442.293-.707.293H9z" strokeLinecap="square" />
                            </g>
                        </svg>
                    </button>

                    {/* 2. 历史会话按钮 */}
                    <button
                        type="button"
                        className={`aui-header-action-btn aui-history-trigger-btn ${historyMenuOpen ? 'is-active' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            setHistoryMenuOpen(!historyMenuOpen);
                        }}
                        title="历史会话"
                        aria-label="历史会话"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="currentColor">
                            <path d="M12 4C9.25 4 6.83 5.39 5.38 7.5H8v2H2v-6h2V6c1.82-2.43 4.73-4 8-4 5.52 0 10 4.48 10 10s-4.48 10-10 10c-4.76 0-8.74-3.33-9.75-7.78l1.95-.44C5.01 17.34 8.19 20 12 20c4.42 0 8-3.58 8-8s-3.58-8-8-8zm-1 4h2v3.59l3.21 3.2-1.42 1.42-3.79-3.8V8z" />
                        </svg>
                    </button>

                    {/* 3. 设置按钮 */}
                    <button
                        type="button"
                        className="aui-header-action-btn"
                        onClick={handleOpenSettings}
                        title="设置与模型参数 (Settings)"
                        aria-label="设置"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="currentColor">
                            <path d="M10.54 1.75h2.92l1.57 2.36c.11.17.32.25.53.21l2.53-.59 2.17 2.17-.58 2.54c-.05.2.04.41.21.53l2.36 1.57v2.92l-2.36 1.57c-.17.12-.26.33-.21.53l.58 2.54-2.17 2.17-2.53-.59c-.21-.04-.42.04-.53.21l-1.57 2.36h-2.92l-1.58-2.36c-.11-.17-.32-.25-.52-.21l-2.54.59-2.17-2.17.58-2.54c.05-.2-.03-.41-.21-.53l-2.35-1.57v-2.92L4.1 8.97c.18-.12.26-.33.21-.53L3.73 5.9 5.9 3.73l2.54.59c.2.04.41-.04.52-.21l1.58-2.36zm1.07 2l-.98 1.47C10.05 6.08 9 6.5 7.99 6.27l-1.46-.34-.6.6.33 1.46c.24 1.01-.18 2.07-1.05 2.64l-1.46.98v.78l1.46.98c.87.57 1.29 1.63 1.05 2.64l-.33 1.46.6.6 1.46-.34c1.01-.23 2.06.19 2.64 1.05l.98 1.47h.78l.97-1.47c.58-.86 1.63-1.28 2.65-1.05l1.45.34.61-.6-.34-1.46c-.23-1.01.18-2.07 1.05-2.64l1.47-.98v-.78l-1.47-.98c-.87-.57-1.28-1.63-1.05-2.64l.34-1.46-.61-.6-1.45.34c-1.02.23-2.07-.19-2.65-1.05l-.97-1.47h-.78zM12 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5c.82 0 1.5-.67 1.5-1.5s-.68-1.5-1.5-1.5zM8.5 12c0-1.93 1.56-3.5 3.5-3.5 1.93 0 3.5 1.57 3.5 3.5s-1.57 3.5-3.5 3.5c-1.94 0-3.5-1.57-3.5-3.5z" />
                        </svg>
                    </button>

                    {/* 4. 关闭按钮 */}
                    {onClose && (
                        <button
                            type="button"
                            className="aui-header-action-btn"
                            onClick={onClose}
                            title="关闭"
                            aria-label="关闭"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="currentColor">
                                <path d="M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z" />
                            </svg>
                        </button>
                    )}

                    {/* 历史会话浮层菜单 (遵循 Screenshot 规范) */}
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
                                <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15" fill="none" style={{ color: '#475569', flexShrink: 0 }}>
                                    <g fill="transparent" stroke="currentColor" strokeLinejoin="round" strokeWidth="2">
                                        <path d="M11 4H7.2c-1.12 0-1.68 0-2.108.218-.376.192-.682.498-.874.874C4 5.52 4 6.08 4 7.2v9.6c0 1.12 0 1.68.218 2.108.192.376.498.682.874.874C5.52 20 6.08 20 7.2 20h9.6c1.12 0 1.68 0 2.108-.218.376-.192.682-.498.874-.874C20 18.48 20 17.92 20 16.8V13" strokeLinecap="round" />
                                        <path d="M9 15v-2.586c0-.265.105-.52.293-.707l8.043-8.043c.78-.78 2.047-.78 2.828 0l.172.172c.78.78.78 2.047 0 2.828l-8.043 8.043c-.188.188-.442.293-.707.293H9z" strokeLinecap="square" />
                                    </g>
                                </svg>
                                <span style={{ fontSize: '12px', fontWeight: 500, color: '#0f172a' }}>Start new chat</span>
                            </div>

                            <div className="yn-gemini-menu-divider" />

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
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', minWidth: 0 }}>
                                            <span style={{ fontSize: '13px', color: '#64748b', flexShrink: 0, fontFamily: 'monospace' }}>≡</span>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' }}>
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

                            <div className="yn-gemini-menu-divider" />

                            <div
                                className="yn-gemini-menu-item"
                                style={{ justifyContent: 'space-between' }}
                                onClick={handleOpenSettings}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15" fill="currentColor" style={{ color: '#64748b', flexShrink: 0 }}>
                                        <path d="M10.54 1.75h2.92l1.57 2.36c.11.17.32.25.53.21l2.53-.59 2.17 2.17-.58 2.54c-.05.2.04.41.21.53l2.36 1.57v2.92l-2.36 1.57c-.17.12-.26.33-.21.53l.58 2.54-2.17 2.17-2.53-.59c-.21-.04-.42.04-.53.21l-1.57 2.36h-2.92l-1.58-2.36c-.11-.17-.32-.25-.52-.21l-2.54.59-2.17-2.17.58-2.54c.05-.2-.03-.41-.21-.53l-2.35-1.57v-2.92L4.1 8.97c.18-.12.26-.33.21-.53L3.73 5.9 5.9 3.73l2.54.59c.2.04.41-.04.52-.21l1.58-2.36zm1.07 2l-.98 1.47C10.05 6.08 9 6.5 7.99 6.27l-1.46-.34-.6.6.33 1.46c.24 1.01-.18 2.07-1.05 2.64l-1.46.98v.78l1.46.98c.87.57 1.29 1.63 1.05 2.64l-.33 1.46.6.6 1.46-.34c1.01-.23 2.06.19 2.64 1.05l.98 1.47h.78l.97-1.47c.58-.86 1.63-1.28 2.65-1.05l1.45.34.61-.6-.34-1.46c-.23-1.01.18-2.07 1.05-2.64l1.47-.98v-.78l-1.47-.98c-.87-.57-1.28-1.63-1.05-2.64l.34-1.46-.61-.6-1.45.34c-1.02.23-2.07-.19-2.65-1.05l-.97-1.47h-.78zM12 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5c.82 0 1.5-.67 1.5-1.5s-.68-1.5-1.5-1.5zM8.5 12c0-1.93 1.56-3.5 3.5-3.5 1.93 0 3.5 1.57 3.5 3.5s-1.57 3.5-3.5 3.5c-1.94 0-3.5-1.57-3.5-3.5z" />
                                    </svg>
                                    <span style={{ fontSize: '12px', color: '#475569' }}>Settings & Help</span>
                                </div>
                                <span style={{ fontSize: '11px', color: '#94a3b8' }}>›</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 对话消息视口 Thread Viewport */}
            <AssistantThread
                messages={currentSession.messages}
                employeeName={employeeName}
                onSuggestionClick={onSuggestionClick}
                onImagePreview={(url) => setPreviewImageUrl(url)}
                onApplyTripPlans={onApplyTripPlans}
                onApplyTravelReports={onApplyTravelReports}
                isExecuting={isExecuting}
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
                selectedModel={selectedModel || llmConfig.model}
                onSelectModel={(newModel) => {
                    const cfg = getLlmConfig();
                    cfg.model = newModel;
                    saveLlmConfig(cfg);
                    setLlmConfig(cfg);
                    onSelectModel?.(newModel);
                }}
                onOpenSettings={handleOpenSettings}
                llmConfig={llmConfig}
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
