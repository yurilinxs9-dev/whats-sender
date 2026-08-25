/**
 * Mensagem de erro da API, com um texto de reserva.
 *
 * A API responde erros de regra de negocio com uma frase pronta para o
 * usuario — qual job segura a instancia, por que a instancia nao pode
 * conectar. Descartar isso e mostrar "Erro ao remover" transforma uma
 * instrucao acionavel em beco sem saida.
 */
export function errMsg(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: unknown } } })?.response
    ?.data?.message;
  if (typeof msg === 'string' && msg.trim().length > 0) return msg;
  // Zod devolve lista de mensagens
  if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0];
  return fallback;
}
