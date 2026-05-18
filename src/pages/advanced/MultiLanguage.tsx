/**
 * MultiLanguage — Language management and translation editor
 * Supported languages, translation editor, RTL toggle, import/export
 * Route: /languages
 */
import { useState } from 'react';
import {
  Globe, Download, Upload, Search,
  ArrowRightLeft, Check
} from 'lucide-react';
import { motion } from 'framer-motion';
import LanguageSwitcher, { SUPPORTED_LANGUAGES, type Language } from '@/components/advanced/LanguageSwitcher';

/* ------------------------------------------------------------------ */
/*  Translation Data                                                   */
/* ------------------------------------------------------------------ */

const DEFAULT_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    'app.title': 'ServiceDesk AI',
    'app.welcome': 'Welcome',
    'nav.dashboard': 'Dashboard',
    'nav.tickets': 'Tickets',
    'nav.knowledge': 'Knowledge Base',
    'nav.settings': 'Settings',
    'ticket.new': 'New Ticket',
    'ticket.status.open': 'Open',
    'ticket.status.resolved': 'Resolved',
    'ticket.priority.high': 'High',
    'ticket.priority.medium': 'Medium',
    'ticket.priority.low': 'Low',
    'common.search': 'Search',
    'common.submit': 'Submit',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.close': 'Close',
    'kb.search_placeholder': 'Search knowledge base...',
    'profile.name': 'Full Name',
    'profile.email': 'Email Address',
    'profile.phone': 'Phone Number',
    'profile.password': 'Password',
    'chat.greeting': 'Hello! How can I help you?',
    'chat.typing': 'Typing...',
    'chat.send': 'Send message',
    'error.generic': 'Something went wrong. Please try again.',
    'success.saved': 'Changes saved successfully.',
  },
  es: {
    'app.title': 'ServiceDesk AI',
    'app.welcome': 'Bienvenido',
    'nav.dashboard': 'Panel',
    'nav.tickets': 'Tickets',
    'nav.knowledge': 'Base de Conocimientos',
    'nav.settings': 'Configuracion',
    'ticket.new': 'Nuevo Ticket',
    'ticket.status.open': 'Abierto',
    'ticket.status.resolved': 'Resuelto',
    'ticket.priority.high': 'Alta',
    'ticket.priority.medium': 'Media',
    'ticket.priority.low': 'Baja',
    'common.search': 'Buscar',
    'common.submit': 'Enviar',
    'common.cancel': 'Cancelar',
    'common.save': 'Guardar',
    'common.delete': 'Eliminar',
    'common.edit': 'Editar',
    'common.close': 'Cerrar',
    'kb.search_placeholder': 'Buscar en la base de conocimientos...',
    'profile.name': 'Nombre Completo',
    'profile.email': 'Correo Electronico',
    'profile.phone': 'Numero de Telefono',
    'profile.password': 'Contrasena',
    'chat.greeting': 'Hola! Como puedo ayudarte?',
    'chat.typing': 'Escribiendo...',
    'chat.send': 'Enviar mensaje',
    'error.generic': 'Algo salio mal. Por favor intenta de nuevo.',
    'success.saved': 'Cambios guardados exitosamente.',
  },
  fr: {
    'app.title': 'ServiceDesk AI',
    'app.welcome': 'Bienvenue',
    'nav.dashboard': 'Tableau de Bord',
    'nav.tickets': 'Tickets',
    'nav.knowledge': 'Base de Connaissances',
    'nav.settings': 'Parametres',
    'ticket.new': 'Nouveau Ticket',
    'ticket.status.open': 'Ouvert',
    'ticket.status.resolved': 'Resolu',
    'ticket.priority.high': 'Haute',
    'ticket.priority.medium': 'Moyenne',
    'ticket.priority.low': 'Faible',
    'common.search': 'Rechercher',
    'common.submit': 'Soumettre',
    'common.cancel': 'Annuler',
    'common.save': 'Enregistrer',
    'common.delete': 'Supprimer',
    'common.edit': 'Modifier',
    'common.close': 'Fermer',
    'kb.search_placeholder': 'Rechercher dans la base de connaissances...',
    'profile.name': 'Nom Complet',
    'profile.email': 'Adresse Email',
    'profile.phone': 'Numero de Telephone',
    'profile.password': 'Mot de Passe',
    'chat.greeting': 'Bonjour! Comment puis-je vous aider?',
    'chat.typing': 'En cours d ecriture...',
    'chat.send': 'Envoyer le message',
    'error.generic': 'Une erreur est survenue. Veuillez reessayer.',
    'success.saved': 'Modifications enregistrees avec succes.',
  },
  de: {
    'app.title': 'ServiceDesk AI',
    'app.welcome': 'Willkommen',
    'nav.dashboard': 'Dashboard',
    'nav.tickets': 'Tickets',
    'nav.knowledge': 'Wissensdatenbank',
    'nav.settings': 'Einstellungen',
    'ticket.new': 'Neues Ticket',
    'ticket.status.open': 'Offen',
    'ticket.status.resolved': 'Gelost',
    'ticket.priority.high': 'Hoch',
    'ticket.priority.medium': 'Mittel',
    'ticket.priority.low': 'Niedrig',
    'common.search': 'Suchen',
    'common.submit': 'Absenden',
    'common.cancel': 'Abbrechen',
    'common.save': 'Speichern',
    'common.delete': 'Loschen',
    'common.edit': 'Bearbeiten',
    'common.close': 'Schliessen',
    'kb.search_placeholder': 'Wissensdatenbank durchsuchen...',
    'profile.name': 'Vollstandiger Name',
    'profile.email': 'E-Mail-Adresse',
    'profile.phone': 'Telefonnummer',
    'profile.password': 'Passwort',
    'chat.greeting': 'Hallo! Wie kann ich Ihnen helfen?',
    'chat.typing': 'Tippt...',
    'chat.send': 'Nachricht senden',
    'error.generic': 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
    'success.saved': 'Anderungen erfolgreich gespeichert.',
  },
  pt: {
    'app.title': 'ServiceDesk AI',
    'app.welcome': 'Bem-vindo',
    'nav.dashboard': 'Painel',
    'nav.tickets': 'Tickets',
    'nav.knowledge': 'Base de Conhecimento',
    'nav.settings': 'Configuracoes',
    'ticket.new': 'Novo Ticket',
    'ticket.status.open': 'Aberto',
    'ticket.status.resolved': 'Resolvido',
    'ticket.priority.high': 'Alta',
    'ticket.priority.medium': 'Media',
    'ticket.priority.low': 'Baixa',
    'common.search': 'Pesquisar',
    'common.submit': 'Enviar',
    'common.cancel': 'Cancelar',
    'common.save': 'Salvar',
    'common.delete': 'Excluir',
    'common.edit': 'Editar',
    'common.close': 'Fechar',
    'kb.search_placeholder': 'Pesquisar na base de conhecimento...',
    'profile.name': 'Nome Completo',
    'profile.email': 'Endereco de Email',
    'profile.phone': 'Numero de Telefone',
    'profile.password': 'Senha',
    'chat.greeting': 'Ola! Como posso ajudar?',
    'chat.typing': 'Digitando...',
    'chat.send': 'Enviar mensagem',
    'error.generic': 'Algo deu errado. Por favor tente novamente.',
    'success.saved': 'Alteracoes salvas com sucesso.',
  },
  ar: {
    'app.title': 'ServiceDesk AI',
    'app.welcome': 'مرحباً',
    'nav.dashboard': 'لوحة التحكم',
    'nav.tickets': 'التذاكر',
    'nav.knowledge': 'قاعدة المعرفة',
    'nav.settings': 'الإعدادات',
    'ticket.new': 'تذكرة جديدة',
    'ticket.status.open': 'مفتوح',
    'ticket.status.resolved': 'تم الحل',
    'ticket.priority.high': 'عالي',
    'ticket.priority.medium': 'متوسط',
    'ticket.priority.low': 'منخفض',
    'common.search': 'بحث',
    'common.submit': 'إرسال',
    'common.cancel': 'إلغاء',
    'common.save': 'حفظ',
    'common.delete': 'حذف',
    'common.edit': 'تعديل',
    'common.close': 'إغلاق',
    'kb.search_placeholder': 'البحث في قاعدة المعرفة...',
    'profile.name': 'الاسم الكامل',
    'profile.email': 'البريد الإلكتروني',
    'profile.phone': 'رقم الهاتف',
    'profile.password': 'كلمة المرور',
    'chat.greeting': 'مرحباً! كيف يمكنني مساعدتك؟',
    'chat.typing': 'يكتب...',
    'chat.send': 'إرسال الرسالة',
    'error.generic': 'حدث خطأ. يرجى المحاولة مرة أخرى.',
    'success.saved': 'تم حفظ التغييرات بنجاح.',
  },
  hi: {
    'app.title': 'ServiceDesk AI',
    'app.welcome': 'स्वागत है',
    'nav.dashboard': 'डैशबोर्ड',
    'nav.tickets': 'टिकट',
    'nav.knowledge': 'ज्ञान कोष',
    'nav.settings': 'सेटिंग्स',
    'ticket.new': 'नया टिकट',
    'ticket.status.open': 'खुला',
    'ticket.status.resolved': 'हल किया',
    'ticket.priority.high': 'उच्च',
    'ticket.priority.medium': 'मध्यम',
    'ticket.priority.low': 'निम्न',
    'common.search': 'खोजें',
    'common.submit': 'जमा करें',
    'common.cancel': 'रद्द करें',
    'common.save': 'सहेजें',
    'common.delete': 'हटाएं',
    'common.edit': 'संपादित करें',
    'common.close': 'बंद करें',
    'kb.search_placeholder': 'ज्ञान कोष खोजें...',
    'profile.name': 'पूरा नाम',
    'profile.email': 'ईमेल पता',
    'profile.phone': 'फोन नंबर',
    'profile.password': 'पासवर्ड',
    'chat.greeting': 'नमस्ते! मैं आपकी कैसे मदद कर सकता हूँ?',
    'chat.typing': 'टाइप कर रहा है...',
    'chat.send': 'संदेश भेजें',
    'error.generic': 'कुछ गलत हो गया। कृपया फिर से प्रयास करें।',
    'success.saved': 'परिवर्तन सफलतापूर्वक सहेजे गए।',
  },
  zh: {
    'app.title': 'ServiceDesk AI',
    'app.welcome': '欢迎',
    'nav.dashboard': '仪表板',
    'nav.tickets': '工单',
    'nav.knowledge': '知识库',
    'nav.settings': '设置',
    'ticket.new': '新建工单',
    'ticket.status.open': '待处理',
    'ticket.status.resolved': '已解决',
    'ticket.priority.high': '高',
    'ticket.priority.medium': '中',
    'ticket.priority.low': '低',
    'common.search': '搜索',
    'common.submit': '提交',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.delete': '删除',
    'common.edit': '编辑',
    'common.close': '关闭',
    'kb.search_placeholder': '搜索知识库...',
    'profile.name': '全名',
    'profile.email': '电子邮件',
    'profile.phone': '电话号码',
    'profile.password': '密码',
    'chat.greeting': '您好！有什么可以帮您？',
    'chat.typing': '正在输入...',
    'chat.send': '发送消息',
    'error.generic': '出错了，请重试。',
    'success.saved': '更改已成功保存。',
  },
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function MultiLanguage() {
  const [translations, setTranslations] = useState(DEFAULT_TRANSLATIONS);
  const [defaultLanguage, setDefaultLanguage] = useState('en');
  const rtlEnabled = true;
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saved, setSaved] = useState(false);

  const enKeys = Object.keys(translations.en);
  const filteredKeys = enKeys.filter((k) => k.includes(searchQuery.toLowerCase()) || translations.en[k].toLowerCase().includes(searchQuery.toLowerCase()));

  const handleExport = () => {
    const dataStr = JSON.stringify(translations, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'translations.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string);
        setTranslations(imported);
      } catch {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const updateTranslation = (lang: string, key: string, value: string) => {
    setTranslations((prev) => ({
      ...prev,
      [lang]: { ...prev[lang], [key]: value },
    }));
  };

  const handleSaveEdit = (lang: string, key: string) => {
    updateTranslation(lang, key, editValue);
    setEditingKey(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const completionRates = SUPPORTED_LANGUAGES.map((lang) => {
    const keys = Object.keys(translations[lang.code] || {});
    const total = enKeys.length;
    const complete = keys.length;
    return { code: lang.code, complete, total, percent: Math.round((complete / total) * 100) };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: '#c9a87c' }}>
            <Globe size={20} className="text-[#1f1f1f]" />
          </div>
          <div>
            <h2 className="text-xl font-medium text-[#1f1f1f]">Language Management</h2>
            <p className="text-sm text-[#595959]">Manage translations, RTL support, and language preferences</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="file" accept=".json" onChange={handleImport} className="hidden" id="import-trans" />
          <label htmlFor="import-trans" className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm text-[#1f1f1f] transition-colors hover:bg-[#fbf9f4]">
            <Upload size={14} /> Import
          </label>
          <button onClick={handleExport} className="flex items-center gap-1.5 rounded-lg border border-[#e5e0d5] bg-white px-3 py-2 text-sm text-[#1f1f1f] transition-colors hover:bg-[#fbf9f4]">
            <Download size={14} /> Export
          </button>
          {saved && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-green-600"><Check size={14} className="inline" /> Saved</motion.span>}
        </div>
      </div>

      {/* Preview */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[#e5e0d5] bg-white px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#595959]">Preview Language:</span>
          <LanguageSwitcher currentLanguage={currentLanguage} onLanguageChange={setCurrentLanguage} />
        </div>
        <div className="h-6 w-px bg-[#e5e0d5]" />
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#595959]">Default:</span>
          <select
            value={defaultLanguage}
            onChange={(e) => setDefaultLanguage(e.target.value)}
            className="rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] px-2 py-1 text-sm outline-none focus:border-[#c9a87c]"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="h-6 w-px bg-[#e5e0d5]" />
        <label className="flex cursor-pointer items-center gap-2">
          <div className={`relative h-5 w-9 rounded-full transition-colors ${rtlEnabled ? 'bg-[#c9a87c]' : 'bg-[#e5e0d5]'}`}>
            <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${rtlEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-sm text-[#1f1f1f]">RTL Support</span>
          {rtlEnabled && <ArrowRightLeft size={14} className="text-[#c9a87c]" />}
        </label>
      </div>

      {/* Language Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {SUPPORTED_LANGUAGES.map((lang) => {
          const completion = completionRates.find((c) => c.code === lang.code);
          return (
            <motion.div
              key={lang.code}
              whileHover={{ y: -2 }}
              className={`rounded-xl border p-4 transition-colors ${defaultLanguage === lang.code ? 'border-[#c9a87c] bg-[#c9a87c]/5' : 'border-[#e5e0d5] bg-white hover:bg-[#fbf9f4]'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">{lang.flag}</span>
                {defaultLanguage === lang.code && <span className="rounded-full bg-[#c9a87c] px-2 py-0.5 text-[10px] font-medium text-white">Default</span>}
              </div>
              <p className="mt-2 text-sm font-medium text-[#1f1f1f]">{lang.name}</p>
              <p className="text-xs text-[#8a8a8a]">{lang.code.toUpperCase()}</p>
              <div className="mt-2">
                <div className="mb-1 flex justify-between text-[10px] text-[#8a8a8a]">
                  <span>Completion</span>
                  <span>{completion?.percent || 0}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#e5e0d5]">
                  <div className="h-1.5 rounded-full transition-all" style={{ width: `${completion?.percent || 0}%`, backgroundColor: '#c9a87c' }} />
                </div>
              </div>
              {lang.rtl && <span className="mt-2 inline-block rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600">RTL</span>}
            </motion.div>
          );
        })}
      </div>

      {/* Translation Editor */}
      <div className="rounded-xl border border-[#e5e0d5] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e5e0d5] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-medium text-[#1f1f1f]">Translation Editor</h3>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search keys or translations..."
              className="rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] py-1.5 pl-8 pr-3 text-sm text-[#1f1f1f] outline-none focus:border-[#c9a87c]"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e0d5] bg-[#fbf9f4]">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#595959]">Key</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#595959]">English</th>
                {SUPPORTED_LANGUAGES.slice(1, 4).map((lang) => (
                  <th key={lang.code} className="px-4 py-2.5 text-left text-xs font-medium text-[#595959]">{lang.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e0d5]/50">
              {filteredKeys.slice(0, 15).map((key) => (
                <tr key={key} className="hover:bg-[#fbf9f4]">
                  <td className="px-4 py-2.5">
                    <code className="rounded bg-[#fbf9f4] px-1.5 py-0.5 text-[11px] text-[#595959]">{key}</code>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-[#1f1f1f]">{translations.en[key]}</td>
                  {SUPPORTED_LANGUAGES.slice(1, 4).map((lang: Language) => {
                    const editId = `${lang.code}-${key}`;
                    const isEditing = editingKey === editId;
                    return (
                      <td key={lang.code} className="px-4 py-2.5">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(lang.code, key)}
                              className="w-32 rounded border border-[#c9a87c] bg-white px-1.5 py-0.5 text-sm outline-none"
                              autoFocus
                            />
                            <button onClick={() => handleSaveEdit(lang.code, key)} className="rounded p-0.5 hover:bg-green-50"><Check size={14} className="text-green-600" /></button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingKey(editId); setEditValue(translations[lang.code]?.[key] || ''); }}
                            className="text-left text-sm text-[#1f1f1f] hover:text-[#c9a87c]"
                          >
                            {translations[lang.code]?.[key] || (
                              <span className="italic text-[#8a8a8a]">-</span>
                            )}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredKeys.length > 15 && (
          <div className="border-t border-[#e5e0d5] px-4 py-2 text-center text-xs text-[#8a8a8a]">
            Showing 15 of {filteredKeys.length} keys
          </div>
        )}
      </div>

      {/* Preview Section */}
      <div className="rounded-xl border border-[#e5e0d5] bg-white p-5">
        <h3 className="mb-3 text-sm font-medium text-[#1f1f1f]">Live Preview ({SUPPORTED_LANGUAGES.find((l) => l.code === currentLanguage)?.name})</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {['app.welcome', 'nav.dashboard', 'ticket.new', 'common.search', 'chat.greeting', 'profile.name', 'common.save', 'error.generic'].map((key) => (
            <div key={key} className="rounded-lg border border-[#e5e0d5] bg-[#fbf9f4] p-3">
              <code className="text-[10px] text-[#8a8a8a]">{key}</code>
              <p className={`mt-1 text-sm font-medium text-[#1f1f1f] ${currentLanguage === 'ar' && rtlEnabled ? 'text-right' : ''}`}>
                {translations[currentLanguage]?.[key] || translations.en[key]}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
