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

// Halaska Kit: Single-file React UI kit for AI products
import {
    ThemeProvider,
    AccentContext,
    usePal,
    tokens,
    motion,
    Button,
    IconButton,
    ButtonGroup,
    TextInput,
    TextArea,
    Select,
    Card,
    CardHeader,
    Divider,
    Stack,
    Badge,
    Tag,
    StatusBadge,
    StatusDot,
    Avatar,
    ListItem,
    EmptyState,
    ThinkingIndicator,
    ThinkingTracePattern,
    PlanPreviewPattern,
    ApprovalCardPattern,
    ActionReceiptPattern,
    Orb,
    AgentGlyph,
    Tooltip,
    Spinner,
    Chip,
    AlertBanner
} from '../halaska-kit';

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

export interface AssistantChatPanelProps {
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

// ─── Header Icons ────────────────────────────────────────────────
const NewChatIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none">
        <g fill="transparent" stroke="currentColor" strokeLinejoin="round" strokeWidth="2">
            <path d="M11 4H7.2c-1.12 0-1.68 0-2.108.218-.376.192-.682.498-.874.874C4 5.52 4 6.08 4 7.2v9.6c0 1.12 0 1.68.218 2.108.192.376.498.682.874.874C5.52 20 6.08 20 7.2 20h9.6c1.12 0 1.68 0 2.108-.218.376-.192.682-.498.874-.874C20 18.48 20 17.92 20 16.8V13" strokeLinecap="round" />
            <path d="M9 15v-2.586c0-.265.105-.52.293-.707l8.043-8.043c.78-.78 2.047-.78 2.828 0l.172.172c.78.78.78 2.047 0 2.828l-8.043 8.043c-.188.188-.442.293-.707.293H9z" strokeLinecap="square" />
        </g>
    </svg>
);

const HistoryIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="currentColor">
        <path d="M12 4C9.25 4 6.83 5.39 5.38 7.5H8v2H2v-6h2V6c1.82-2.43 4.73-4 8-4 5.52 0 10 4.48 10 10s-4.48 10-10 10c-4.76 0-8.74-3.33-9.75-7.78l1.95-.44C5.01 17.34 8.19 20 12 20c4.42 0 8-3.58 8-8s-3.58-8-8-8zm-1 4h2v3.59l3.21 3.2-1.42 1.42-3.79-3.8V8z" />
    </svg>
);

const SettingsIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="currentColor">
        <path d="M10.54 1.75h2.92l1.57 2.36c.11.17.32.25.53.21l2.53-.59 2.17 2.17-.58 2.54c-.05.2.04.41.21.53l2.36 1.57v2.92l-2.36 1.57c-.17.12-.26.33-.21.53l.58 2.54-2.17 2.17-2.53-.59c-.21-.04-.42.04-.53.21l-1.57 2.36h-2.92l-1.58-2.36c-.11-.17-.32-.25-.52-.21l-2.54.59-2.17-2.17.58-2.54c.05-.2-.03-.41-.21-.53l-2.35-1.57v-2.92L4.1 8.97c.18-.12.26-.33.21-.53L3.73 5.9 5.9 3.73l2.54.59c.2.04.41-.04.52-.21l1.58-2.36zm1.07 2l-.98 1.47C10.05 6.08 9 6.5 7.99 6.27l-1.46-.34-.6.6.33 1.46c.24 1.01-.18 2.07-1.05 2.64l-1.46.98v.78l1.46.98c.87.57 1.29 1.63 1.05 2.64l-.33 1.46.6.6 1.46-.34c1.01-.23 2.06.19 2.64 1.05l.98 1.47h.78l.97-1.47c.58-.86 1.63-1.28 2.65-1.05l1.45.34.61-.6-.34-1.46c-.23-1.01.18-2.07 1.05-2.64l1.47-.98v-.78l-1.47-.98c-.87-.57-1.28-1.63-1.05-2.64l.34-1.46-.61-.6-1.45.34c-1.02.23-2.07-.19-2.65-1.05l-.97-1.47h-.78zM12 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5c.82 0 1.5-.67 1.5-1.5s-.68-1.5-1.5-1.5zM8.5 12c0-1.93 1.56-3.5 3.5-3.5 1.93 0 3.5 1.57 3.5 3.5s-1.57 3.5-3.5 3.5c-1.94 0-3.5-1.57-3.5-3.5z" />
    </svg>
);

const CloseIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="currentColor">
        <path d="M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z" />
    </svg>
);

/**
 * 1. ThinkingSection: Halaska Kit 深度思考呈现组件
 */
export const ThinkingSection: React.FC<{
    thinking: ThinkingData;
    onToggle?: () => void;
}> = ({ thinking, onToggle }) => {
    const pal = usePal('light');
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

    if (isThinking) {
        return (
            <Card
                padding={10}
                style={{
                    border: '1px solid #bfdbfe',
                    background: 'linear-gradient(135deg, #f0f7ff 0%, #ffffff 100%)',
                    borderRadius: tokens.radius.md,
                    boxShadow: '0 2px 6px rgba(37, 99, 235, 0.06)'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Orb variant="pulse" size={16} color="#2563eb" />
                    <ThinkingIndicator label="AI 正在深度思考规划..." size="sm" />
                </div>
                {thinking.content && (
                    <div
                        style={{
                            marginTop: '8px',
                            padding: '8px 10px',
                            background: '#ffffff',
                            borderRadius: tokens.radius.sm,
                            border: '1px solid #e2e8f0',
                            fontSize: '11px',
                            lineHeight: 1.5,
                            color: '#64748b',
                            fontFamily: tokens.font.mono,
                            whiteSpace: 'pre-wrap',
                            maxHeight: '180px',
                            overflowY: 'auto'
                        }}
                    >
                        {thinking.content}
                    </div>
                )}
            </Card>
        );
    }

    return (
        <Card
            padding={8}
            style={{
                border: '1px solid #e2e8f0',
                background: isExpanded ? '#fafafa' : '#ffffff',
                borderRadius: tokens.radius.md,
                transition: `all ${motion.fast} ${motion.easeInOut}`
            }}
        >
            <div
                onClick={handleToggle}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    userSelect: 'none',
                    padding: '2px 4px'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AgentGlyph size={18} />
                    <span style={{ fontSize: '12px', fontWeight: 500, color: '#334155' }}>
                        已完成深度思考
                    </span>
                    {durationSec && (
                        <Badge variant="secondary" style={{ fontSize: '10.5px', height: '18px', padding: '0 6px' }}>
                            耗时 {durationSec}s
                        </Badge>
                    )}
                </div>
                <span
                    style={{
                        fontSize: '11px',
                        color: '#94a3b8',
                        transform: isExpanded ? 'rotate(180deg)' : 'none',
                        transition: `transform ${motion.fast} ${motion.easeOut}`
                    }}
                >
                    ▾
                </span>
            </div>
            {isExpanded && (
                <div
                    style={{
                        marginTop: '8px',
                        padding: '8px 10px',
                        borderTop: '1px solid #e2e8f0',
                        fontSize: '11px',
                        lineHeight: 1.5,
                        color: '#475569',
                        fontFamily: tokens.font.mono,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: '220px',
                        overflowY: 'auto',
                        background: '#ffffff',
                        borderRadius: tokens.radius.sm
                    }}
                >
                    {thinking.content || '思考过程已归档'}
                </div>
            )}
        </Card>
    );
};

/**
 * 2. ToolCallSection: Halaska Kit 结构化工具调用卡片
 */
export const ToolCallSection: React.FC<{
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
        <Card
            padding={8}
            style={{
                border: '1px solid #e2e8f0',
                borderRadius: tokens.radius.md,
                background: '#ffffff',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)'
            }}
        >
            <div
                onClick={handleToggle}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    userSelect: 'none',
                    padding: '2px 4px'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px' }}>{toolCall.icon || '⚙️'}</span>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: '#1e293b' }}>
                        {toolCall.title || toolCall.name}
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {toolCall.status === 'running' && (
                        <StatusBadge status="accent" pulse={true}>
                            执行中
                        </StatusBadge>
                    )}
                    {toolCall.status === 'done' && (
                        <StatusBadge status="online">
                            ✓ 完成
                        </StatusBadge>
                    )}
                    {toolCall.status === 'error' && (
                        <StatusBadge status="danger">
                            ✕ 异常
                        </StatusBadge>
                    )}
                    <span
                        style={{
                            fontSize: '11px',
                            color: '#94a3b8',
                            transform: isExpanded ? 'rotate(180deg)' : 'none',
                            transition: `transform ${motion.fast} ${motion.easeOut}`
                        }}
                    >
                        ▾
                    </span>
                </div>
            </div>

            {toolCall.progress && toolCall.status === 'running' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '11px', color: '#2563eb' }}>
                    <Spinner size={12} color="#2563eb" />
                    <span>{toolCall.progress}</span>
                </div>
            )}

            {isExpanded && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #f1f5f9' }}>
                    {toolCall.input && (
                        <div>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '2px', fontWeight: 600 }}>
                                输入参数 (Inputs):
                            </div>
                            <div
                                style={{
                                    fontSize: '10.5px',
                                    fontFamily: tokens.font.mono,
                                    background: '#f8fafc',
                                    padding: '6px 8px',
                                    borderRadius: tokens.radius.sm,
                                    border: '1px solid #e2e8f0',
                                    color: '#334155',
                                    whiteSpace: 'pre-wrap',
                                    maxHeight: '140px',
                                    overflowY: 'auto'
                                }}
                            >
                                {typeof toolCall.input === 'string' ? toolCall.input : JSON.stringify(toolCall.input, null, 2)}
                            </div>
                        </div>
                    )}
                    {toolCall.output && (
                        <div style={{ marginTop: '6px' }}>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '2px', fontWeight: 600 }}>
                                返回结果 (Outputs):
                            </div>
                            <div
                                style={{
                                    fontSize: '10.5px',
                                    fontFamily: tokens.font.mono,
                                    background: '#f8fafc',
                                    padding: '6px 8px',
                                    borderRadius: tokens.radius.sm,
                                    border: '1px solid #e2e8f0',
                                    color: '#334155',
                                    whiteSpace: 'pre-wrap',
                                    maxHeight: '140px',
                                    overflowY: 'auto'
                                }}
                            >
                                {typeof toolCall.output === 'string' ? toolCall.output : JSON.stringify(toolCall.output, null, 2)}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
};

/**
 * 3. MarkdownContent: 富文本与流式呈现组件
 */
export const MarkdownContent: React.FC<{
    content: string;
    isStreaming?: boolean;
}> = ({ content, isStreaming = false }) => {
    if (!content) return null;

    return (
        <div className="aui-markdown" style={{ fontFamily: tokens.font.sans }}>
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
 * 4. AssistantThread: 对话流视口与 Halaska Kit 空白态
 */
export const AssistantThread: React.FC<{
    messages: ChatMessage[];
    employeeName: string;
    selectedModel?: string;
    onSuggestionClick?: (key: 'infer' | 'itinerary' | 'autopilot-plan' | 'dashboard') => void;
    onImagePreview?: (url: string) => void;
    onApplyTripPlans?: (messageId: string, action: TripPlanConfirmationAction) => void;
    onApplyTravelReports?: (messageId: string, action: TravelReportConfirmationAction) => void;
    isExecuting?: boolean;
}> = ({
    messages,
    employeeName,
    selectedModel = 'gemini-3.8-flash',
    onSuggestionClick,
    onImagePreview,
    onApplyTripPlans,
    onApplyTravelReports,
    isExecuting
}) => {
    const viewportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (viewportRef.current) {
            viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }
    }, [messages]);

    const shortName = employeeName ? employeeName.slice(0, 2) : '社员';

    if (messages.length === 0) {
        return (
            <div className="aui-thread-viewport" ref={viewportRef} style={{ background: '#fafafa' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: 'auto 0', padding: '28px 12px', textAlign: 'center' }}>
                    <Orb variant="pulse" size={44} color="#2563eb" />

                    <div style={{ marginTop: '16px', fontSize: '18px', fontWeight: 600, color: '#0f172a', letterSpacing: '-0.02em' }}>
                        Ask away, {shortName}!
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#64748b', maxWidth: '340px', lineHeight: 1.5 }}>
                        元年云费控极速自动驾驶副驾已就绪。支持粘贴排期、智能对账、提取发票必填项与一键极速建单。
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', width: '100%', marginTop: '24px' }}>
                        <Card
                            hover={true}
                            padding={12}
                            onClick={() => onSuggestionClick?.('infer')}
                            style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: tokens.radius.lg, background: '#ffffff' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <span style={{ fontSize: '16px' }}>🔮</span>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>智能推断已选费用</span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
                                基于发票 OCR 自动推导交通住宿必填项
                            </div>
                        </Card>

                        <Card
                            hover={true}
                            padding={12}
                            onClick={() => onSuggestionClick?.('itinerary')}
                            style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: tokens.radius.lg, background: '#ffffff' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <span style={{ fontSize: '16px' }}>📋</span>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>粘贴排期规划 Trip</span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
                                粘贴日程表格，深度推理往返闭环
                            </div>
                        </Card>

                        <Card
                            hover={true}
                            padding={12}
                            onClick={() => onSuggestionClick?.('autopilot-plan')}
                            style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: tokens.radius.lg, background: '#ffffff' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <span style={{ fontSize: '16px' }}>✨</span>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>全流程智能规划</span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
                                一键聚类出差往返与日常办公费用
                            </div>
                        </Card>

                        <Card
                            hover={true}
                            padding={12}
                            onClick={() => onSuggestionClick?.('dashboard')}
                            style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: tokens.radius.lg, background: '#ffffff' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <span style={{ fontSize: '16px' }}>🚀</span>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>报销单管理看板</span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
                                统一管理申请单 (SC) 与报销单 (BC/BJ)
                            </div>
                        </Card>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="aui-thread-viewport" ref={viewportRef} style={{ background: '#fafafa', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {messages.map((msg) => {
                const isUser = msg.role === 'user';
                const timeStr = msg.time || new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

                return (
                    <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
                        {/* 消息元信息栏 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: isUser ? 'flex-end' : 'flex-start', padding: '0 4px' }}>
                            {isUser ? (
                                <>
                                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>{timeStr}</span>
                                    <Avatar name={employeeName || '社员'} size={20} />
                                </>
                            ) : (
                                <>
                                    <AgentGlyph size={18} />
                                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#2563eb' }}>AI 智能副驾</span>
                                    <Badge variant="outline" style={{ fontSize: '10px', height: '18px', padding: '0 6px' }}>
                                        {selectedModel}
                                    </Badge>
                                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>{timeStr}</span>
                                </>
                            )}
                        </div>

                        {/* 费用上下文胶囊 */}
                        {isUser && msg.expenseContext && (
                            <div style={{ alignSelf: 'flex-end', marginBottom: '2px' }}>
                                <Chip selected={true} style={{ background: '#e0f2fe', borderColor: '#bae6fd', color: '#0369a1', fontSize: '11px' }}>
                                    📎 关联费用: {msg.expenseContext.count} 笔 (¥{Number(msg.expenseContext.totalAmount || 0).toFixed(2)})
                                </Chip>
                            </div>
                        )}

                        {/* 附件缩略卡片 */}
                        {msg.attachments && msg.attachments.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                                {msg.attachments.map((att) => (
                                    <div
                                        key={att.id}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '5px',
                                            padding: '3px 8px',
                                            background: '#ffffff',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: tokens.radius.sm,
                                            fontSize: '11px',
                                            color: '#334155',
                                            cursor: att.type === 'image' && att.dataUrl ? 'pointer' : 'default'
                                        }}
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
                            <div
                                style={{
                                    alignSelf: 'flex-end',
                                    maxWidth: '88%',
                                    background: '#2563eb',
                                    color: '#ffffff',
                                    padding: '10px 14px',
                                    borderRadius: '16px 16px 4px 16px',
                                    fontSize: '12.5px',
                                    lineHeight: 1.5,
                                    wordBreak: 'break-word',
                                    whiteSpace: 'pre-wrap',
                                    boxShadow: '0 2px 8px rgba(37, 99, 235, 0.18)'
                                }}
                            >
                                {msg.text}
                            </div>
                        ) : (
                            <Card
                                padding={14}
                                style={{
                                    alignSelf: 'flex-start',
                                    maxWidth: '100%',
                                    width: '100%',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '16px 16px 16px 4px',
                                    background: '#ffffff',
                                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '10px'
                                }}
                            >
                                {/* Thinking 深度思考手风琴 */}
                                {msg.thinking && (
                                    <ThinkingSection thinking={msg.thinking} />
                                )}

                                {/* Tool Call 工具卡片流 */}
                                {msg.toolCalls && msg.toolCalls.length > 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {msg.toolCalls.map((tool) => (
                                            <ToolCallSection key={tool.id} toolCall={tool} />
                                        ))}
                                    </div>
                                )}

                                {/* Markdown 正文 或 AlertBanner 提示 */}
                                {msg.text && (() => {
                                    if (msg.text.startsWith('⚠️ 大模型回复异常：')) {
                                        const parts = msg.text.replace('⚠️ 大模型回复异常：', '').split('\n\n以下为您提取的底层客观数据：');
                                        const errReason = parts[0]?.trim() || '未能获取大模型有效响应';
                                        const rest = parts[1] ? `以下为您提取的底层客观数据：\n\n${parts[1].trim()}` : '';
                                        return (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <AlertBanner
                                                    theme="light"
                                                    variant="warning"
                                                    title="大模型响应提示"
                                                    description={errReason}
                                                />
                                                {rest && <MarkdownContent content={rest} isStreaming={msg.isStreaming} />}
                                            </div>
                                        );
                                    }
                                    return <MarkdownContent content={msg.text} isStreaming={msg.isStreaming} />;
                                })()}

                                {/* HITL 出差排期确认: PlanPreviewPattern / ActionReceiptPattern */}
                                {msg.confirmationAction && msg.confirmationAction.type === 'APPLY_TRIP_PLANS' && (
                                    <div style={{ marginTop: '4px' }}>
                                        {!msg.confirmationAction.applied ? (
                                            <PlanPreviewPattern
                                                theme="light"
                                                title="出差排期规划建议 (HITL)"
                                                subtitle="AI 已识别出差往返闭环，请复核后点击确认应用至费用明细表"
                                                steps={msg.confirmationAction.trips.map((t, idx) =>
                                                    `Trip ${idx + 1}: ${t.origin || '起点'} ➔ ${t.destination || '目的地'} (${t.startDate || ''} ~ ${t.endDate || ''}, 共 ${t.days || 1} 天)`
                                                )}
                                                badgeLabel="待确认"
                                                proceedLabel={`确认应用到表格 (${msg.confirmationAction.trips.length} 轮 Trip)`}
                                                editLabel="人工微调"
                                                handoffLabel="手动排期"
                                                onProceed={() => onApplyTripPlans?.(msg.id, msg.confirmationAction as TripPlanConfirmationAction)}
                                            />
                                        ) : (
                                            <ActionReceiptPattern
                                                theme="light"
                                                title="出差排期规划已生效"
                                                stripLabel="排期规划"
                                                meta={[
                                                    { label: "应用项目", value: `${msg.confirmationAction.trips.length} 轮往返 Trip` },
                                                    { label: "生效时间", value: msg.confirmationAction.appliedTime || "已生效" },
                                                    { label: "执行模式", value: "人类在回路确认 (HITL)" }
                                                ]}
                                                before={0}
                                                after={msg.confirmationAction.trips.length}
                                                unit="Trips"
                                                autoplay={false}
                                            />
                                        )}
                                    </div>
                                )}

                                {/* HITL 出差报告回填: ApprovalCardPattern / ActionReceiptPattern */}
                                {msg.confirmationAction && msg.confirmationAction.type === 'APPLY_TRAVEL_REPORTS' && (
                                    <div style={{ marginTop: '4px' }}>
                                        {!msg.confirmationAction.applied ? (
                                            <ApprovalCardPattern
                                                theme="light"
                                                eyebrow="需要人工核准 (HITL)"
                                                badgeLabel="待回填"
                                                question={`是否确认将 AI 撰写的 ${msg.confirmationAction.reports.length} 份出差工作总结报告回填至对应报销单？`}
                                                options={msg.confirmationAction.reports.map((r, i) => ({
                                                    id: `report_${i}`,
                                                    title: r.title || `出差总结报告 ${i + 1}`,
                                                    sub: r.dest ? `目的地: ${r.dest} · 关联单据: ${r.billId || '待匹配'}` : undefined
                                                }))}
                                                approveLabel={`确认回填至单据 (${msg.confirmationAction.reports.length} 份)`}
                                                skipLabel="暂不回填"
                                                onApprove={() => onApplyTravelReports?.(msg.id, msg.confirmationAction as TravelReportConfirmationAction)}
                                            />
                                        ) : (
                                            <ActionReceiptPattern
                                                theme="light"
                                                title="出差总结报告已回填"
                                                stripLabel="报告回填"
                                                meta={[
                                                    { label: "回填单据", value: `${msg.confirmationAction.reports.length} 份出差报告` },
                                                    { label: "生效时间", value: msg.confirmationAction.appliedTime || "已生效" },
                                                    { label: "单据字段", value: "【出差报告】正文" }
                                                ]}
                                                before={0}
                                                after={msg.confirmationAction.reports.length}
                                                unit="份"
                                                autoplay={false}
                                            />
                                        )}
                                    </div>
                                )}
                            </Card>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

/**
 * 5. AssistantComposer: Halaska Kit 复合输入框
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
    selectedModel = 'gemini-3.8-flash',
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
            const cur = activeCfg?.model || selectedModel || 'gemini-3.8-flash';
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

    // Auto-resize textarea
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
        <div style={{ padding: '12px 16px', background: '#ffffff', borderTop: '1px solid #e2e8f0', position: 'relative' }}>
            <Card
                padding={10}
                style={{
                    border: isDragOver ? '1px solid #2563eb' : '1px solid #cbd5e1',
                    borderRadius: tokens.radius.lg,
                    background: '#ffffff',
                    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                }}
                onDragOver={(e: any) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={(e: any) => { e.preventDefault(); setIsDragOver(false); }}
                onDrop={(e: any) => {
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
                                <Chip
                                    selected={true}
                                    onRemove={() => onToggleContext(false)}
                                    style={{ background: '#e0f2fe', borderColor: '#bae6fd', color: '#0369a1', fontSize: '11px' }}
                                >
                                    📎 已选中 {selectedCount} 笔费用 (¥{selectedAmount.toFixed(2)})
                                </Chip>
                            )}
                            {activeSkill && (
                                <Tag
                                    color="#f59e0b"
                                    removable={true}
                                    onRemove={onDismissSkill}
                                >
                                    {activeSkill.icon} 技能: {activeSkill.name}
                                </Tag>
                            )}
                        </div>

                        {activeSkill && (
                            <div
                                style={{
                                    background: '#f8fafc',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: tokens.radius.sm,
                                    padding: '6px 10px',
                                    fontSize: '11px',
                                    color: '#475569'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                                    <span style={{ fontWeight: 600, color: '#1e293b' }}>💡 {activeSkill.hintTitle}</span>
                                    {activeSkill.actionText && (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={onCopyPromptTemplate}
                                            style={{ height: '22px', padding: '0 8px', fontSize: '10.5px' }}
                                        >
                                            {activeSkill.actionText}
                                        </Button>
                                    )}
                                </div>
                                <div style={{ fontSize: '10.5px', lineHeight: 1.4 }}>{activeSkill.hintText}</div>
                            </div>
                        )}
                    </div>
                )}

                {/* 附件列表卡片 */}
                {attachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {attachments.map((att) => (
                            <Chip
                                key={att.id}
                                selected={false}
                                onRemove={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                                style={{ fontSize: '11px' }}
                            >
                                <span>{att.type === 'image' ? '🖼️' : '📄'}</span>
                                <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {att.name}
                                </span>
                            </Chip>
                        ))}
                    </div>
                )}

                {/* Slash Menu 浮层 */}
                {slashMenuOpen && slashMatchingSkills.length > 0 && (
                    <Card
                        padding={0}
                        style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: 16,
                            right: 16,
                            marginBottom: '8px',
                            zIndex: 100,
                            borderRadius: tokens.radius.md,
                            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            overflow: 'hidden'
                        }}
                    >
                        <div style={{ padding: '6px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: '#64748b' }}>
                            <span>副驾快捷技能 (Skills)</span>
                            <span>↑↓ 导航 · Tab/Enter 确认 · Esc 关闭</span>
                        </div>
                        <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                            {slashMatchingSkills.map((s, idx) => (
                                <div
                                    key={s.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        background: idx === slashSelectedIndex ? '#eff6ff' : 'transparent',
                                        borderBottom: '1px solid #f1f5f9'
                                    }}
                                    onClick={() => {
                                        setInputText((prev) => prev.replace(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/, ''));
                                        setSlashMenuOpen(false);
                                        onApplySkill(s.id);
                                    }}
                                >
                                    <span>{s.icon}</span>
                                    <span style={{ fontFamily: tokens.font.mono, fontWeight: 600, color: '#2563eb', fontSize: '11px' }}>
                                        {s.command}
                                    </span>
                                    <span style={{ fontWeight: 600, fontSize: '11.5px', color: '#1e293b' }}>
                                        {s.name}
                                    </span>
                                    <span style={{ fontSize: '10.5px', color: '#64748b', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {s.summary}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </Card>
                )}

                {/* 文本输入框 */}
                <textarea
                    ref={textareaRef}
                    placeholder="输入指令或向副驾提问（键入 '/' 唤出技能，支持拖拽发票/排期截图或附件）..."
                    rows={1}
                    value={inputText}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    style={{
                        width: '100%',
                        border: 'none',
                        outline: 'none',
                        resize: 'none',
                        fontSize: '12.5px',
                        lineHeight: 1.5,
                        color: '#0f172a',
                        background: 'transparent',
                        padding: '4px 2px',
                        fontFamily: tokens.font.sans,
                        boxSizing: 'border-box'
                    }}
                />

                {/* Composer 工具栏 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px', borderTop: '1px solid #f1f5f9' }}>
                    <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        multiple
                        accept="image/*,.pdf,.doc,.docx,.xlsx,.xls,.txt,.csv"
                        onChange={(e) => handleFiles(e.target.files)}
                    />

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <IconButton
                            icon={<span style={{ fontSize: '16px', fontWeight: 600 }}>＋</span>}
                            size={28}
                            variant="ghost"
                            label="添加附件文件或图片"
                            onClick={() => fileInputRef.current?.click()}
                        />

                        <div style={{ position: 'relative' }}>
                            <Button
                                size="sm"
                                variant={skillMenuOpen ? "secondary" : "ghost"}
                                onClick={() => setSkillMenuOpen(!skillMenuOpen)}
                                style={{ height: '28px', padding: '0 8px', fontSize: '11px' }}
                            >
                                <span>⚡ 技能 ▾</span>
                            </Button>

                            {skillMenuOpen && (
                                <Card
                                    padding={0}
                                    style={{
                                        position: 'absolute',
                                        bottom: '100%',
                                        left: 0,
                                        width: '260px',
                                        marginBottom: '8px',
                                        zIndex: 100,
                                        borderRadius: tokens.radius.md,
                                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                        border: '1px solid #cbd5e1',
                                        background: '#ffffff',
                                        overflow: 'hidden'
                                    }}
                                >
                                    <div style={{ padding: '6px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '10.5px', fontWeight: 600, color: '#475569' }}>
                                        选择副驾技能 (Skills)
                                    </div>
                                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                        {skills.map((s) => (
                                            <div
                                                key={s.id}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    padding: '8px 12px',
                                                    cursor: 'pointer',
                                                    borderBottom: '1px solid #f1f5f9'
                                                }}
                                                onClick={() => {
                                                    setSkillMenuOpen(false);
                                                    onApplySkill(s.id);
                                                }}
                                            >
                                                <span>{s.icon}</span>
                                                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#1e293b' }}>{s.name}</span>
                                                        <span style={{ fontSize: '10px', color: '#2563eb', fontFamily: tokens.font.mono }}>{s.command}</span>
                                                    </div>
                                                    <div style={{ fontSize: '10px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.summary}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </Card>
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
                                    borderRadius: tokens.radius.sm,
                                    fontSize: '11px',
                                    fontFamily: tokens.font.sans,
                                    fontWeight: 500,
                                    color: '#334155',
                                    padding: '2px 6px',
                                    outline: 'none',
                                    cursor: 'pointer',
                                    maxWidth: '170px',
                                    height: '28px'
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

                    <Button
                        size="sm"
                        variant="primary"
                        onClick={handleSend}
                        disabled={isExecuting || (!inputText.trim() && attachments.length === 0)}
                        style={{
                            height: '28px',
                            minWidth: '34px',
                            padding: '0 10px',
                            borderRadius: tokens.radius.sm
                        }}
                    >
                        {isExecuting ? <Orb variant="pulse" size={14} color="#ffffff" /> : <span>▲</span>}
                    </Button>
                </div>
            </Card>
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

    // 监听全局配置变更事件，毫秒级响应
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
            if (!target.closest('.aui-history-menu') && !target.closest('.aui-history-btn')) {
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
        <ThemeProvider theme="light">
            <AccentContext.Provider value="#2563eb">
                <div
                    className="aui-root"
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        width: '100%',
                        height: '100%',
                        background: '#ffffff',
                        fontFamily: tokens.font.sans,
                        position: 'relative',
                        overflow: 'hidden'
                    }}
                >
                    {/* 顶栏 Header: 标题 + 右上角 4 按钮 (新会话、历史会话、设置、关闭) */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderBottom: '1px solid #e2e8f0',
                            background: '#ffffff',
                            position: 'relative',
                            zIndex: 20
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <Orb variant="spark" size={18} color="#2563eb" />
                            <span style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>
                                AI 智能副驾
                            </span>
                            {currentSession.title && (
                                <Badge
                                    variant="secondary"
                                    style={{
                                        fontSize: '11px',
                                        maxWidth: '130px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                    }}
                                    title={currentSession.title}
                                >
                                    {currentSession.title}
                                </Badge>
                            )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                            {/* 1. 新会话按钮 */}
                            <IconButton
                                icon={<NewChatIcon />}
                                size={28}
                                variant="ghost"
                                label="开启新会话 (Start new chat)"
                                onClick={() => {
                                    setHistoryMenuOpen(false);
                                    onNewSession();
                                }}
                            />

                            {/* 2. 历史会话按钮 */}
                            <span className="aui-history-btn">
                                <IconButton
                                    icon={<HistoryIcon />}
                                    size={28}
                                    variant={historyMenuOpen ? "secondary" : "ghost"}
                                    label="历史会话"
                                    onClick={(e: any) => {
                                        e.stopPropagation();
                                        setHistoryMenuOpen(!historyMenuOpen);
                                    }}
                                />
                            </span>

                            {/* 3. 设置按钮 */}
                            <IconButton
                                icon={<SettingsIcon />}
                                size={28}
                                variant="ghost"
                                label="设置与模型参数 (Settings)"
                                onClick={handleOpenSettings}
                            />

                            {/* 4. 关闭按钮 */}
                            {onClose && (
                                <IconButton
                                    icon={<CloseIcon />}
                                    size={28}
                                    variant="ghost"
                                    label="关闭"
                                    onClick={onClose}
                                />
                            )}
                        </div>

                        {/* 历史会话浮层菜单 */}
                        {historyMenuOpen && (
                            <Card
                                padding={6}
                                className="aui-history-menu"
                                style={{
                                    position: 'absolute',
                                    top: '44px',
                                    right: '12px',
                                    width: '260px',
                                    zIndex: 1000,
                                    borderRadius: tokens.radius.md,
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                    border: '1px solid #cbd5e1',
                                    background: '#ffffff'
                                }}
                                onClick={(e: any) => e.stopPropagation()}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '8px 10px',
                                        cursor: 'pointer',
                                        borderRadius: tokens.radius.sm,
                                        transition: `background ${motion.fast}`
                                    }}
                                    onClick={() => {
                                        setHistoryMenuOpen(false);
                                        onNewSession();
                                    }}
                                >
                                    <NewChatIcon />
                                    <span style={{ fontSize: '12px', fontWeight: 500, color: '#0f172a' }}>
                                        Start new chat
                                    </span>
                                </div>

                                <Divider style={{ margin: '4px 0' }} />

                                <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                                    {sessions.map((s) => (
                                        <div
                                            key={s.id}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '7px 10px',
                                                cursor: 'pointer',
                                                borderRadius: tokens.radius.sm,
                                                background: s.id === currentSession.id ? '#eff6ff' : 'transparent'
                                            }}
                                            onClick={() => {
                                                setHistoryMenuOpen(false);
                                                onSelectSession(s.id);
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', minWidth: 0 }}>
                                                <span style={{ fontSize: '12px', color: '#64748b', fontFamily: tokens.font.mono }}>≡</span>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', color: '#1e293b' }}>
                                                    {s.title || '未命名会话'}
                                                </span>
                                            </div>
                                            {sessions.length > 1 && (
                                                <span
                                                    style={{ cursor: 'pointer', color: '#94a3b8', fontSize: '12px', padding: '0 4px' }}
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

                                <Divider style={{ margin: '4px 0' }} />

                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '7px 10px',
                                        cursor: 'pointer',
                                        borderRadius: tokens.radius.sm
                                    }}
                                    onClick={handleOpenSettings}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <SettingsIcon />
                                        <span style={{ fontSize: '12px', color: '#475569' }}>Settings & Models</span>
                                    </div>
                                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>›</span>
                                </div>
                            </Card>
                        )}
                    </div>

                    {/* 对话消息视口 Thread Viewport */}
                    <AssistantThread
                        messages={currentSession.messages}
                        employeeName={employeeName}
                        selectedModel={selectedModel || llmConfig.model}
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
                                style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: tokens.radius.lg, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                            />
                            <IconButton
                                icon={<CloseIcon />}
                                size={36}
                                variant="secondary"
                                label="关闭预览"
                                onClick={() => setPreviewImageUrl(null)}
                                style={{ position: 'absolute', top: '20px', right: '20px', background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                            />
                        </div>
                    )}
                </div>
            </AccentContext.Provider>
        </ThemeProvider>
    );
};
