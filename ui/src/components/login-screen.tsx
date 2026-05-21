/**
 * @file Login screen component.
 * The user enters the Bearer token that is both the HTTP auth token and the
 * AES-256-CBC decryption password for the encrypted vault stored in KV.
 */

import React, { useState } from 'react';
import { Alert, Button, Card, Form, Input, Label, TextField } from '@heroui/react';
import { useAi } from '../hooks/use-ai';
import { LogIn } from 'lucide-react';

/**
 * Full-page login screen shown when the user is not authenticated.
 *
 * The token is stored in sessionStorage (not localStorage),
 * so it is automatically cleared when the browser tab is closed. It is never
 * sent to anything other than the Cloudflare Worker endpoint.
 */
export const LoginScreen: React.FC = () => {
  /** Controlled value of the token input field. */
  const [token, setToken] = useState('');

  /** Error message to display when login fails (null = no error). */
  const [localError, setLocalError] = useState<string | null>(null);

  const { login, loading } = useAi();

  /**
   * Submits the token to the `login` function from the AI context.
   * If login fails (e.g. wrong token / HTTP 401), shows an inline error.
   */
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError(null);
    try {
      await login(token);
    } catch {
      // We intentionally don't expose the raw error to the UI for security.
      setLocalError('Login failed. Please check your token.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md p-6">
        <Card.Header className="flex flex-col gap-1 text-center">
          <Card.Title className="text-2xl font-bold">AI Vault Manager</Card.Title>
          <Card.Description>
            Enter your authorization token to manage the AI Proxy vault.
          </Card.Description>
        </Card.Header>

        <Card.Content className="mt-4">
          <Form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* isRequired adds native HTML5 validation + aria-required attribute */}
            <TextField isRequired name="token">
              <Label>Authorization Token</Label>
              <Input type="hidden" autoComplete="username" value="AI Vault Admin" readOnly className="hidden" />
              <Input
                type="password"
                placeholder="Paste your token here..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="current-password"
                variant="secondary"
              />
            </TextField>

            {/* Only rendered when there is an error to show */}
            {localError && (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Title>Authentication error</Alert.Title>
                  <Alert.Description>{localError}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            {/*
             * isPending comes from react-aria's Button: it disables the button
             * and adds an animated spinner while the async login call is running.
             */}
            <Button
              type="submit"
              fullWidth
              isPending={loading}
              className="mt-2"
            >
              <LogIn className="mr-2 h-4 w-4" />
              Connect to Vault
            </Button>
          </Form>
        </Card.Content>

        <Card.Footer className="mt-4 text-center">
          <p className="text-xs text-muted">
            The token is stored only in the session storage and is never persisted.
          </p>
        </Card.Footer>
      </Card>
    </div>
  );
};
