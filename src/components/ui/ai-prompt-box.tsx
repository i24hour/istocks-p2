import React, { useRef, useEffect } from 'react';
import { Send, Square, Paperclip, X, Download, FileSpreadsheet, FileText, ImageIcon } from 'lucide-react';
import type { AttachmentKind } from '@/lib/chat-attachments';
import { useTheme } from '../ThemeProvider';
import { AnimatedDropdown } from './dropdown-01';
import { COMPUTE_MODEL_OPTIONS, type ComputeModelId } from '@/lib/compute-models.client';

type TradingMode = 'PAPER' | 'LIVE';
type BrokerName = 'ZERODHA' | 'DHAN' | 'GROWW';

export interface AttachedFile {
    id: string
    name: string
    kind: AttachmentKind
}

/** @deprecated use AttachedFile */
export type AttachedExcelFile = AttachedFile

interface PromptInputBoxProps {
    input: string;
    setInput: (val: string) => void;
    handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    handleSend: () => void;
    handleStop: () => void;
    isLoading: boolean;
    tradingMode?: TradingMode;
    selectedBroker?: BrokerName;
    onTradingModeChange?: (mode: TradingMode) => void;
    onBrokerChange?: (broker: BrokerName) => void;
    computeModel?: ComputeModelId;
    onComputeModelChange?: (model: ComputeModelId) => void;
    attachedFiles?: AttachedFile[];
    onAttachFiles?: (files: FileList) => void;
    onRemoveFile?: (id: string) => void;
    onDownloadMerged?: () => void;
    canDownloadMerged?: boolean;
    /** When false, attach button is hidden (Free plan or monthly cap reached). */
    canAttach?: boolean;
    attachQuotaLabel?: string;
}

export function PromptInputBox({
    input,
    setInput,
    handleInputChange,
    handleKeyDown,
    handleSend,
    handleStop,
    isLoading,
    tradingMode,
    selectedBroker,
    onTradingModeChange,
    onBrokerChange,
    computeModel,
    onComputeModelChange,
    attachedFiles = [],
    onAttachFiles,
    onRemoveFile,
    onDownloadMerged,
    canDownloadMerged = false,
    canAttach = true,
    attachQuotaLabel,
}: PromptInputBoxProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const showTradeControls =
        !!tradingMode && !!selectedBroker && !!onTradingModeChange && !!onBrokerChange;
    const showComputeModel = !!computeModel && !!onComputeModelChange;
    const hasFiles = attachedFiles.length > 0;

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        }
    }, [input]);

    const handleFileClick = () => fileInputRef.current?.click();

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0 && onAttachFiles) {
            onAttachFiles(e.target.files);
        }
        // reset so same file can be re-added
        e.target.value = '';
    };

    const canSend = !!(input.trim() || hasFiles);
    const excelFileCount = attachedFiles.filter(f => f.kind === 'excel').length;

    const FileKindIcon = ({ kind }: { kind: AttachmentKind }) => {
        if (kind === 'excel') return <FileSpreadsheet className="w-3 h-3 shrink-0 opacity-70" />;
        if (kind === 'pdf') return <FileText className="w-3 h-3 shrink-0 opacity-70" />;
        return <ImageIcon className="w-3 h-3 shrink-0 opacity-70" />;
    };

    return (
        <div
            className={`w-full relative flex flex-col border transition-all focus-within:ring-2 focus-within:ring-[var(--accent)]/25 focus-within:border-[var(--accent)]/40 ${
                isDark
                    ? 'rounded-2xl shadow-lg shadow-black/20'
                    : 'rounded-[1.75rem] shadow-none'
            }`}
            style={{
                backgroundColor: isDark ? 'var(--card-bg)' : 'var(--chat-composer-bg)',
                borderColor: isDark ? 'var(--card-border)' : 'var(--chat-composer-border)',
            }}
        >
            {/* ── Attached file chips ── */}
            {hasFiles && (
                <div className="flex flex-wrap gap-1.5 px-3.5 pt-2.5 pb-0">
                    {attachedFiles.map(f => (
                        <span
                            key={f.id}
                            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                                isDark
                                    ? 'bg-[var(--accent)]/10 border-[var(--accent)]/25 text-[var(--accent)]'
                                    : 'bg-green-50 border-green-200 text-green-700'
                            }`}
                        >
                            <FileKindIcon kind={f.kind} />
                            <span className="max-w-[120px] truncate">{f.name}</span>
                            {onRemoveFile && (
                                <button
                                    type="button"
                                    onClick={() => onRemoveFile(f.id)}
                                    className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                                    title="Remove file"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </span>
                    ))}
                    {canDownloadMerged && onDownloadMerged && excelFileCount > 1 && (
                        <button
                            type="button"
                            onClick={onDownloadMerged}
                            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium transition-opacity hover:opacity-80 ${
                                isDark
                                    ? 'bg-blue-500/10 border-blue-400/30 text-blue-400'
                                    : 'bg-blue-50 border-blue-200 text-blue-600'
                            }`}
                            title="Download merged Excel"
                        >
                            <Download className="w-3 h-3" />
                            Download merged
                        </button>
                    )}
                </div>
            )}

            <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={hasFiles ? 'Ask about your attachments, or say "merge" for Excel…' : 'Ask the trading agent…'}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                rows={1}
                className="w-full bg-transparent px-3.5 sm:px-4 pt-3 sm:pt-3.5 pb-[3.25rem] sm:pb-14 outline-none resize-none min-h-[48px] sm:min-h-[52px] text-[15px] sm:text-[15px] leading-snug scrollbar-thin placeholder:text-[var(--text-muted)]"
                style={{ color: 'var(--text-primary)' }}
                disabled={isLoading}
            />

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.pdf,image/jpeg,image/png,image/webp,image/gif,image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
            />

            {/* Bottom tools row */}
            <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2 min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap overflow-x-auto overflow-y-visible min-w-0 pr-1 scrollbar-hide">
                    {onAttachFiles && (
                        <button
                            type="button"
                            onClick={canAttach ? handleFileClick : undefined}
                            disabled={isLoading || !canAttach}
                            title={attachQuotaLabel || 'Attach Excel, CSV, PDF, or image (Pro: 5/month)'}
                            aria-label="Attach"
                            className={`p-2 sm:p-2.5 rounded-full border transition-all shrink-0 disabled:opacity-40 ${
                                isDark
                                    ? 'bg-[var(--card-bg)] border-[var(--card-border)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)]'
                                    : 'bg-white border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-green-300 hover:text-green-600'
                            }`}
                        >
                            <Paperclip className="w-4 h-4" />
                        </button>
                    )}

                    {showTradeControls && (
                        <>
                            <AnimatedDropdown
                                className="min-w-[5.25rem] h-7 sm:h-8 px-2 sm:px-3 shrink-0"
                                options={[
                                    { id: 'PAPER', label: 'PAPER' },
                                    { id: 'LIVE', label: 'LIVE' },
                                ]}
                                selectedId={tradingMode}
                                onSelect={(val) => onTradingModeChange(val as TradingMode)}
                            />
                            <AnimatedDropdown
                                className="min-w-[5.5rem] h-7 sm:h-8 px-2 sm:px-3 shrink-0"
                                options={[
                                    { id: 'ZERODHA', label: 'ZERODHA' },
                                    { id: 'DHAN', label: 'DHAN' },
                                    { id: 'GROWW', label: 'GROWW' },
                                ]}
                                selectedId={selectedBroker}
                                onSelect={(val) => onBrokerChange(val as BrokerName)}
                            />
                            {showComputeModel && (
                                <AnimatedDropdown
                                    className="min-w-[6rem] h-7 sm:h-8 px-2 sm:px-3 shrink-0"
                                    options={COMPUTE_MODEL_OPTIONS.map(m => ({ id: m.id, label: m.label, description: m.description, deprecated: m.deprecated }))}
                                    selectedId={computeModel}
                                    onSelect={(val) => onComputeModelChange(val as ComputeModelId)}
                                />
                            )}
                        </>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {isLoading ? (
                        <button
                            onClick={handleStop}
                            type="button"
                            className={`p-2 text-white transition-all shadow-md ${isDark ? 'rounded-xl' : 'rounded-full'}`}
                            style={{ backgroundColor: 'var(--danger)' }}
                            title="Stop generating"
                        >
                            <Square className="w-4 h-4 fill-current" />
                        </button>
                    ) : (
                        <button
                            onClick={handleSend}
                            disabled={!canSend}
                            type="button"
                            className={`p-2 sm:p-2.5 text-white disabled:opacity-45 disabled:cursor-not-allowed transition-all shadow-md flex items-center justify-center ${isDark ? 'rounded-xl' : 'rounded-full'}`}
                            style={{ backgroundColor: 'var(--accent)' }}
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
