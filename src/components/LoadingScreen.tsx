import { motion } from 'framer-motion';
import { HomeShell, LogoCore } from './home/HomeParts';

/**
 * Tela cheia, centralizada — some assim que o mapa é liberado (rootId
 * setado) ou volta pra tela de decisão em caso de falha. Só "Carregando...",
 * sem texto de fase/progresso (decisão de produto); o movimento fica por
 * conta do núcleo em varredura e da barra indeterminada.
 */
export function LoadingScreen() {
  return (
    <HomeShell>
      <div className="loading-stage">
        <motion.div
          role="status"
          aria-label="Carregando"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
        >
          <LogoCore size={190} scanning />
        </motion.div>
        <motion.h1
          className="loading-title"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          Carregando...
        </motion.h1>
        <div className="loading-bar indeterminate" aria-hidden="true">
          <span />
        </div>
      </div>
    </HomeShell>
  );
}
