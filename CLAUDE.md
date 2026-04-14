# WhatsApp Sender — Projeto

## Stack
- Frontend: Next.js 14 App Router + TypeScript -> Vercel
- Backend: NestJS + Socket.IO -> VPS Docker (187.127.11.117)
- DB: Supabase PostgreSQL + Storage
- ORM: Prisma (SEMPRE usar directUrl para migrations)
- Filas: BullMQ + Upstash Redis TLS
- WhatsApp: UazAPI (ja instalada na VPS)

## Regras CRITICAS
1. NUNCA `any` no TypeScript
2. SEMPRE directUrl no Prisma para migrations
3. SEMPRE bcrypt salt 12 para senhas
4. SEMPRE validar input com Zod
5. SEMPRE emitir WebSocket apos mutacoes de campanha/instancia
6. SEMPRE FFmpeg no Dockerfile do backend
7. NUNCA disparar sem delay - minimo 5s entre mensagens
8. NUNCA disparar fora da janela horaria (22h-7h = bloqueado)
9. SEMPRE BullMQ para disparos - NUNCA sincrono
10. SEMPRE content spin em cada mensagem

## Estrutura
- apps/web: Next.js frontend
- apps/api: NestJS backend
- packages/shared: tipos compartilhados
- nginx/: configuracao do reverse proxy

## Design System
- Background: #09090b, Surface: #18181b, Border: #27272a
- Primary: #22c55e (green), Danger: #ef4444, Warning: #f59e0b
- Font: Geist (Vercel), Icons: Lucide React
- Dark mode ONLY
