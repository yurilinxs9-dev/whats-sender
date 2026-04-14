'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth.store';
import { api } from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const { data } = await api.post('/auth/login', { email, senha });
      setAuth(
        {
          id: data.user.id,
          nome: data.user.nome,
          email: data.user.email,
          role: data.user.role,
          tenantId: data.user.tenantId,
        },
        data.accessToken,
      );
      router.push('/');
    } catch {
      toast.error('Credenciais invalidas');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-surface">
        <CardHeader className="items-center space-y-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <MessageSquare className="h-7 w-7 text-zinc-950" />
          </div>
          <div className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold text-text-primary">WhatsApp Sender</CardTitle>
            <CardDescription className="text-text-secondary">
              Enterprise Stealth Messaging Platform
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-text-secondary">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="senha" className="text-sm font-medium text-text-secondary">
                Senha
              </label>
              <Input
                id="senha"
                type="password"
                placeholder="********"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
              ) : (
                'Entrar'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
