import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';

function freeProjectIntegrityPlugin() {
  return {
    name: 'free-project-integrity-check',
    buildStart() {
      const noticePath = path.resolve(__dirname, 'FREE_PROJECT_NOTICE.md');
      if (!fs.existsSync(noticePath)) {
        throw new Error(
          '\n\n[FATAL BUILD ERROR] Repository integrity check failed: Missing FREE_PROJECT_NOTICE.md!\n' +
          'Dungeon Master OS is an open and free project. The build cannot proceed without the required declaration file: FREE_PROJECT_NOTICE.md\n'
        );
      }

      const noticeContent = fs.readFileSync(noticePath, 'utf-8');
      if (!noticeContent.includes('FREE, OPEN-ACCESS PROJECT') || !noticeContent.toLowerCase().includes('free of charge')) {
        throw new Error(
          '\n\n[FATAL BUILD ERROR] Repository integrity check failed: FREE_PROJECT_NOTICE.md has been tampered with or modified.\n' +
          'Dungeon Master OS must remain declared as a free public project.\n'
        );
      }

      const htmlPath = path.resolve(__dirname, 'index.html');
      if (fs.existsSync(htmlPath)) {
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        if (!htmlContent.includes('sidebar-free-notice')) {
          throw new Error(
            '\n\n[FATAL BUILD ERROR] HTML integrity check failed: The required "sidebar-free-notice" element is missing from index.html.\n' +
            'Dungeon Master OS builds require the free project disclosure notice in the interface.\n'
          );
        }
      }
    }
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      build: {
        target: 'esnext',
        minify: 'terser',
        terserOptions: {
          compress: {
            passes: 2,
            pure_getters: true,
            unsafe_arrows: true,
            unsafe_comps: true,
            unsafe_math: true,
          },
          mangle: {
            toplevel: true,
          },
          format: {
            comments: false,
          }
        }
      },
      optimizeDeps: {
        esbuildOptions: {
          target: 'esnext'
        }
      },
      server: {
        port: 3005,
        host: '0.0.0.0',
      },
      plugins: [freeProjectIntegrityPlugin()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        '__FREE_PROJECT_VERIFIED__': true
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
