"use client"

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '../ThemeProvider';

export interface DropdownOption {
    id: string;
    label: string;
    description?: string;
    deprecated?: boolean;
}

interface AnimatedDropdownProps {
    options: DropdownOption[];
    selectedId: string;
    onSelect: (optionId: string) => void;
    className?: string;
}

export function AnimatedDropdown({ options, selectedId, onSelect, className }: AnimatedDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const selectedOption = options.find(o => o.id === selectedId) || options[0];

    const recalcPosition = useCallback(() => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        setMenuStyle({
            position: 'fixed',
            left: rect.left,
            bottom: window.innerHeight - rect.top + 8,
            zIndex: 9999,
        });
    }, []);

    const handleToggle = () => {
        if (!isOpen) recalcPosition();
        setIsOpen(prev => !prev);
    };

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                buttonRef.current?.contains(e.target as Node) ||
                menuRef.current?.contains(e.target as Node)
            ) return;
            setIsOpen(false);
        };
        const handleScroll = () => isOpen && recalcPosition();
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', recalcPosition);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', recalcPosition);
        };
    }, [isOpen, recalcPosition]);

    const menu = (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    ref={menuRef}
                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    style={menuStyle}
                    className={cn(
                        "w-max min-w-[120px] rounded-xl border overflow-hidden shadow-2xl",
                        isDark
                            ? "bg-dark-300 border-white/10 shadow-black/50"
                            : "bg-white border-gray-200 shadow-gray-200/50"
                    )}
                >
                    {options.map((option, index) => (
                        <motion.button
                            key={option.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.15, delay: index * 0.04 }}
                            onClick={() => {
                                if (!option.deprecated) {
                                    onSelect(option.id);
                                    setIsOpen(false);
                                }
                            }}
                            className={cn(
                                "w-full px-3 py-2 text-left transition-colors duration-200 flex items-center justify-between group",
                                option.deprecated
                                    ? "opacity-40 cursor-not-allowed"
                                    : isDark
                                        ? "hover:bg-white/5 text-white"
                                        : "hover:bg-gray-50 text-black",
                                index !== options.length - 1 && (isDark ? "border-b border-white/5" : "border-b border-gray-100"),
                                option.deprecated && (isDark ? "text-gray-500" : "text-gray-400"),
                            )}
                        >
                            <div>
                                <div className={cn(
                                    "text-[11px] font-semibold",
                                    !option.deprecated && selectedId === option.id && (isDark ? "text-emerald-400" : "text-emerald-600"),
                                    option.deprecated && "line-through"
                                )}>
                                    {option.label}
                                </div>
                                {option.deprecated && (
                                    <div className="text-[9px] mt-0.5 text-orange-400/80 font-medium">Deprecated</div>
                                )}
                                {!option.deprecated && option.description && (
                                    <div className={cn(
                                        "text-[9px] mt-0.5",
                                        isDark ? "text-gray-500 group-hover:text-gray-400" : "text-gray-500 group-hover:text-gray-600"
                                    )}>
                                        {option.description}
                                    </div>
                                )}
                            </div>
                            {selectedId === option.id && (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                >
                                    <Check className={cn("w-3.5 h-3.5 ml-3", isDark ? "text-emerald-400" : "text-emerald-600")} />
                                </motion.div>
                            )}
                        </motion.button>
                    ))}
                </motion.div>
            )}
        </AnimatePresence>
    );

    return (
        <div className="relative">
            <motion.button
                ref={buttonRef}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleToggle}
                className={cn(
                    "flex items-center justify-between gap-2 h-8 px-3 rounded-lg border outline-none transition-all duration-300 min-w-[100px]",
                    isDark
                        ? "bg-dark-300/70 border-white/10 text-gray-200 hover:bg-dark-300 hover:border-emerald-500/50"
                        : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-emerald-500",
                    className
                )}
            >
                <span className="font-semibold tracking-wide text-[10px] sm:text-[11px]">{selectedOption.label}</span>
                <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.25 }}>
                    <ChevronDown className="w-3 h-3 opacity-70" />
                </motion.div>
            </motion.button>

            {typeof window !== 'undefined' && createPortal(menu, document.body)}
        </div>
    );
}
