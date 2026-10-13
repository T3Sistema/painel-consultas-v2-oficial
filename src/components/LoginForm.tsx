import { FormEvent, KeyboardEvent, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthStore } from '../store/authStore';
import { HomeShell, LogoCore, Typewriter } from './home/HomeParts';

const PHRASES = ['Acesso restrito a usuários autorizados.', 'Cada consulta começa com quem você é.', 'Identifique-se para abrir o mapa.'];

/** Itens do "checklist" do lado da marca — só fatos verdadeiros do sistema. */
const ASSURANCES = [
  'Sessão protegida no servidor',
  'Dados sensíveis mascarados por padrão',
  'Nenhuma consulta sem identificação',
];

const ease = [0.2, 0.9, 0.3, 1] as const;

function Icon({ d, size = 17 }: { d: React.ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );
}

const USER_ICON = (
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
  </>
);

/**
 * Tela de login — exibida antes de liberar qualquer parte do sistema.
 * Mesmo cenário da tela inicial (rede viva + núcleo do logo); o cartão
 * de acesso se monta com cantos de mira, a borda corre um feixe de luz
 * (mais rápido enquanto verifica, vermelho no erro) e o cartão treme
 * quando as credenciais são recusadas.
 */
export function LoginForm() {
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [focus, setFocus] = useState<'email' | 'password' | null>(null);
  const [attempt, setAttempt] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const ok = await login(email.trim(), password);
      if (ok === false) setAttempt((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  };

  const state = submitting ? 'verifying' : error ? 'denied' : 'idle';
  const canSubmit = !submitting && !!email.trim() && !!password.trim();

  return (
    <HomeShell>
      <div className="login">
        <motion.aside
          className="login-brand"
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease }}
        >
          <LogoCore size={230} scanning={submitting} />
          <motion.span
            className="home-badge"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
          >
            <i />
            Ambiente restrito
          </motion.span>
          <h1 className="home-title login-title" data-text="PAINEL DE CONSULTAS">
            PAINEL DE CONSULTAS
          </h1>
          <Typewriter phrases={PHRASES} className="home-sub" />
          <ul className="login-assure">
            {ASSURANCES.map((a, i) => (
              <motion.li
                key={a}
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: 0.7 + i * 0.18, ease }}
              >
                <span className="login-check">
                  <Icon d={<path d="m5 12 5 5 9-10" />} size={12} />
                </span>
                {a}
              </motion.li>
            ))}
          </ul>
        </motion.aside>

        <motion.section
          className="login-stage"
          initial={{ opacity: 0, y: 30, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.15, ease }}
        >
          <motion.div
            key={attempt}
            className={`login-card is-${state}`}
            animate={attempt ? { x: [0, -14, 12, -9, 6, -3, 0] } : undefined}
            transition={{ duration: 0.5 }}
          >
            <span className="login-beam" aria-hidden="true" />
            {(['tl', 'tr', 'bl', 'br'] as const).map((c, i) => (
              <motion.span
                key={c}
                className={`login-corner ${c}`}
                aria-hidden="true"
                initial={{ opacity: 0, scale: 1.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.45 + i * 0.07, ease }}
              />
            ))}
            {submitting && <span className="login-scan" aria-hidden="true" />}

            <div className="login-inner">
              <div className="login-head">
                <span className={`login-lock ${state}`} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path className="login-shackle" d="M8 11V8a4 4 0 0 1 8 0v3" />
                    <circle cx="12" cy="15.5" r="1.2" fill="currentColor" />
                  </svg>
                </span>
                <div>
                  <h2>Acesso restrito</h2>
                  <p>Entre com suas credenciais para continuar.</p>
                </div>
              </div>

              <form onSubmit={submit} className="login-form" noValidate={false}>
                <div className={`login-field ${focus === 'email' ? 'is-focused' : ''} ${email ? 'has-value' : ''}`}>
                  <span className="login-field-icon">
                    <Icon d={USER_ICON} />
                  </span>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value.toLowerCase().replace(/\s/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === ' ') e.preventDefault();
                    }}
                    onKeyUp={trackCaps}
                    onFocus={() => setFocus('email')}
                    onBlur={() => setFocus(null)}
                    autoCapitalize="off"
                    autoComplete="username"
                    placeholder=" "
                    autoFocus
                    required
                  />
                  <label htmlFor="email">E-mail</label>
                  <span className="login-field-line" aria-hidden="true" />
                </div>

                <div className={`login-field ${focus === 'password' ? 'is-focused' : ''} ${password ? 'has-value' : ''}`}>
                  <span className="login-field-icon">
                    <Icon
                      d={
                        <>
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                        </>
                      }
                    />
                  </span>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value.replace(/\s/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === ' ') e.preventDefault();
                    }}
                    onKeyUp={trackCaps}
                    onFocus={() => setFocus('password')}
                    onBlur={() => setFocus(null)}
                    autoComplete="current-password"
                    placeholder=" "
                    required
                  />
                  <label htmlFor="password">Senha</label>
                  <button
                    type="button"
                    className="login-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPassword ? (
                      <Icon
                        size={16}
                        d={
                          <>
                            <path d="M3 3l18 18" />
                            <path d="M10.6 10.6a3 3 0 0 0 4.24 4.24" />
                            <path d="M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.2M16.9 16.9C19.5 15.1 22 12 22 12s-1.2-2.4-3.3-4.3" />
                          </>
                        }
                      />
                    ) : (
                      <Icon
                        size={16}
                        d={
                          <>
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                          </>
                        }
                      />
                    )}
                  </button>
                  <span className="login-field-line" aria-hidden="true" />
                </div>

                <AnimatePresence>
                  {capsLock && (
                    <motion.p
                      className="login-caps"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <Icon size={14} d={<path d="M12 4 4 12h4v6h8v-6h4L12 4Z" />} />
                      Caps Lock está ativado
                    </motion.p>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {error && (
                    <motion.p
                      key={`${error}-${attempt}`}
                      className="login-error"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                <button type="submit" disabled={!canSubmit} className={`login-submit ${submitting ? 'is-busy' : ''}`}>
                  <span className="login-submit-shine" aria-hidden="true" />
                  {submitting ? (
                    <>
                      <span role="status" aria-label="Carregando" className="login-spinner" />
                      Verificando…
                    </>
                  ) : (
                    <>
                      Entrar
                      <Icon size={16} d={<path d="M5 12h14M13 6l6 6-6 6" />} />
                    </>
                  )}
                </button>
              </form>
            </div>
          </motion.div>

          <p className="login-foot">Powered by: TRIAD3 Inteligência</p>
        </motion.section>
      </div>
    </HomeShell>
  );
}

/**
 * Transição de "acesso liberado": anel que se expande, check desenhado e a
 * saudação — por cima da tela que acabou de abrir, some sozinha.
 */
export function AccessGranted({ name, onDone }: { name?: string; onDone: () => void }) {
  return (
    <motion.div
      className="granted"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 0.55, delay: 1.15, ease: 'easeIn' }}
      onAnimationComplete={onDone}
      aria-hidden="true"
    >
      <span className="granted-wave" />
      <span className="granted-wave late" />
      <motion.div
        className="granted-core"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.2, 1.4, 0.4, 1] }}
      >
        <svg viewBox="0 0 52 52" width="64" height="64">
          <circle className="granted-ring" cx="26" cy="26" r="23" />
          <path className="granted-check" d="M15 27l7 7 15-16" />
        </svg>
      </motion.div>
      <motion.p
        className="granted-title"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.25 }}
      >
        Acesso liberado
      </motion.p>
      {name && (
        <motion.p
          className="granted-sub"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
        >
          Bem-vindo, {name}
        </motion.p>
      )}
    </motion.div>
  );
}
