/**
 * LanguageSwitcher — Dropdown to switch UI language
 * Embeddable component for switching between supported languages
 */
import { useState } from 'react';
import { Globe, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface Language {
  code: string;
  name: string;
  flag: string;
  rtl: boolean;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', name: 'English', flag: '\u{1F1FA}\u{1F1F8}', rtl: false },
  { code: 'es', name: 'Spanish', flag: '\u{1F1EA}\u{1F1F8}', rtl: false },
  { code: 'fr', name: 'French', flag: '\u{1F1EB}\u{1F1F7}', rtl: false },
  { code: 'de', name: 'German', flag: '\u{1F1E9}\u{1F1EA}', rtl: false },
  { code: 'pt', name: 'Portuguese', flag: '\u{1F1F5}\u{1F1F9}', rtl: false },
  { code: 'ar', name: 'Arabic', flag: '\u{1F1E6}\u{1F1EA}', rtl: true },
  { code: 'hi', name: 'Hindi', flag: '\u{1F1EE}\u{1F1F3}', rtl: false },
  { code: 'zh', name: 'Chinese', flag: '\u{1F1E8}\u{1F1F3}', rtl: false },
];

interface LanguageSwitcherProps {
  currentLanguage: string;
  onLanguageChange: (code: string) => void;
}

export default function LanguageSwitcher({ currentLanguage, onLanguageChange }: LanguageSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const current = SUPPORTED_LANGUAGES.find((l) => l.code === currentLanguage) || SUPPORTED_LANGUAGES[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm transition-colors hover:bg-[#fbf9f4]"
      >
        <Globe size={16} style={{ color: '#c9a87c' }} />
        <span className="mr-1">{current.flag}</span>
        <span className="text-[#1f1f1f]">{current.name}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 z-50 mt-1 w-52 rounded-xl border border-[#e5e0d5] bg-white shadow-lg"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => { onLanguageChange(lang.code); setIsOpen(false); }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-[#fbf9f4] ${
                    currentLanguage === lang.code ? 'bg-[#c9a87c]/10 font-medium' : ''
                  }`}
                >
                  <span className="text-base">{lang.flag}</span>
                  <span className="flex-1 text-[#1f1f1f]">{lang.name}</span>
                  {currentLanguage === lang.code && <Check size={14} style={{ color: '#c9a87c' }} />}
                  {lang.rtl && <span className="text-[10px] text-[#8a8a8a]">RTL</span>}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
