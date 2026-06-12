// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import React, { useState } from 'react';
import {
  Button,
  Card,
  Chip,
  Table,
  Tabs,
  Modal,
  useOverlayState,
} from '@heroui/react';
import { Edit, Key, Plus, Trash2, CreditCard } from 'lucide-react';
import type { Crawler } from '../../types/ai-config';

interface CreditUsage {
  remainingCredits: number;
  billingPeriodEnd: string;
  error?: string;
}

/** Props for {@link CrawlerCard}. */
interface CrawlerCardProps {
  /** Dictionary key of the crawler. */
  id: string;
  /** Crawler data from the vault. */
  crawler: Crawler;
  /** Called when the user clicks "Delete Crawler". */
  onDelete: () => void;
  /** Called when the user clicks "Edit Crawler". */
  onEdit: () => void;
  /** Called when the user clicks "Add Key". */
  onAddKey: () => void;
  /** Called with the array index of the key to edit. */
  onEditKey: (index: number) => void;
  /** Called with the array index of the key to delete. */
  onDeleteKey: (index: number) => void;
}

/**
 * Card component that renders a single crawler with its API keys.
 */
export const CrawlerCard: React.FC<CrawlerCardProps> = ({
  id,
  crawler,
  onDelete,
  onEdit,
  onAddKey,
  onEditKey,
  onDeleteKey,
}) => {
  const [creditUsages, setCreditUsages] = useState<CreditUsage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const creditModalState = useOverlayState();

  const fetchCreditUsage = async (apiKey: string): Promise<CreditUsage> => {
    try {
      const response = await fetch('https://api.firecrawl.dev/v2/team/credit-usage', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.data) {
        return {
          remainingCredits: data.data.remainingCredits,
          billingPeriodEnd: data.data.billingPeriodEnd
        };
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      return {
        remainingCredits: 0,
        billingPeriodEnd: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };

  const handleShowCredits = async () => {
    setIsLoading(true);
    creditModalState.open();

    try {
      const results = await Promise.all(
        crawler.keys.map(key => fetchCreditUsage(key.key))
      );
      setCreditUsages(results);
    } catch (error) {
      console.error('Error fetching credit usage:', error);
      setCreditUsages(crawler.keys.map(() => ({
        remainingCredits: 0,
        billingPeriodEnd: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      })));
    } finally {
      setIsLoading(false);
    }
  };

  const calculateDaysRemaining = (billingPeriodEnd: string): string => {
    if (!billingPeriodEnd) return 'N/A';

    try {
      const endDate = new Date(billingPeriodEnd);
      const now = new Date();
      const diffTime = endDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays > 0 ? `${diffDays} days` : 'Expired';
    } catch {
      return 'N/A';
    }
  };

  return (
    <>
      <Card className="overflow-hidden border-l-4 border-l-primary">
        {/* ── Crawler header ──────────────────────────────────────────────── */}
        <Card.Header className="flex flex-row items-center justify-between bg-muted/5 p-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Card.Title className="text-xl font-bold">{id}</Card.Title>
              {/* Protocol chip */}
              <Chip size="sm" variant="soft" color="accent">
                {crawler.protocol}
              </Chip>
            </div>
            <Card.Description className="font-mono text-xs">
              {crawler.endpoint}
            </Card.Description>
          </div>
          <div className="flex gap-2">
            <Button isIconOnly size="sm" variant="ghost" onPress={onEdit} aria-label="Edit crawler">
              <Edit className="h-4 w-4" />
            </Button>
            <Button isIconOnly size="sm" variant="danger-soft" onPress={onDelete} aria-label="Delete crawler">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </Card.Header>

        {/* ── API Keys panel ──────────────────────────────────────────── */}
        <Card.Content className="p-0">
          <Tabs variant="secondary">
            <Tabs.ListContainer className="border-b px-4">
              <Tabs.List aria-label={`${id} sections`}>
                <Tabs.Tab id="keys">
                  <div className="flex items-center gap-2 py-2">
                    <Key className="h-3.5 w-3.5" />
                    API Keys ({crawler.keys.length})
                  </div>
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>

            {/* ── API Keys panel ──────────────────────────────────────────── */}
            <Tabs.Panel id="keys" className="p-4">
              <div className="mb-2 flex justify-end gap-2">
                <Button size="sm" variant="tertiary" onPress={onAddKey}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Add Key
                </Button>
                <Button size="sm" variant="tertiary" onPress={handleShowCredits}>
                  <CreditCard className="mr-2 h-3.5 w-3.5" />
                  Show Credits
                </Button>
              </div>
              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content aria-label={`${id} API keys`}>
                    <Table.Header>
                      <Table.Column isRowHeader>Key (Masked)</Table.Column>
                      <Table.Column>Owner</Table.Column>
                      <Table.Column>Type</Table.Column>
                      <Table.Column className="text-end">Actions</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {crawler.keys.map((apiKey, index) => (
                        <Table.Row key={index}>
                          {/* Show only first 8 and last 4 chars to avoid exposing the key */}
                          <Table.Cell className="font-mono">
                            {apiKey.key.substring(0, 8)}…
                            {apiKey.key.substring(apiKey.key.length - 4)}
                          </Table.Cell>
                          <Table.Cell>{apiKey.owner ?? '—'}</Table.Cell>
                          <Table.Cell>
                            {apiKey.type && (
                              <Chip size="sm" variant="soft">
                                {apiKey.type}
                              </Chip>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <div className="flex justify-end gap-1">
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                onPress={() => onEditKey(index)}
                                aria-label={`Edit key ${index}`}
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="danger-soft"
                                onPress={() => onDeleteKey(index)}
                                aria-label={`Delete key ${index}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </Tabs.Panel>
          </Tabs>
        </Card.Content>
      </Card>

      {/* Credit Usage Modal */}
      <Modal state={creditModalState}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-2xl">
              <Modal.Header>
                <Modal.Heading>Credit Usage for {id}</Modal.Heading>
              </Modal.Header>

              <Modal.Body>
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <p>Loading credit information...</p>
                  </div>
                ) : (
                  <Table variant="secondary">
                    <Table.ScrollContainer>
                      <Table.Content aria-label="Credit usage information">
                        <Table.Header>
                          <Table.Column isRowHeader>Key (Masked)</Table.Column>
                          <Table.Column>Remaining Credits</Table.Column>
                          <Table.Column>Days Until Reset</Table.Column>
                          <Table.Column>Status</Table.Column>
                        </Table.Header>
                        <Table.Body>
                          {creditUsages.map((usage, index) => {
                            const apiKey = crawler.keys[index];
                            const daysRemaining = calculateDaysRemaining(usage.billingPeriodEnd);
                            return (
                              <Table.Row key={index}>
                                <Table.Cell className="font-mono">
                                  {apiKey.key.substring(0, 8)}…
                                  {apiKey.key.substring(apiKey.key.length - 4)}
                                </Table.Cell>
                                <Table.Cell>
                                  {usage.error ? (
                                    <span className="text-danger-600">Error: {usage.error}</span>
                                  ) : (
                                    usage.remainingCredits.toLocaleString()
                                  )}
                                </Table.Cell>
                                <Table.Cell>
                                  {usage.error ? 'N/A' : daysRemaining}
                                </Table.Cell>
                                <Table.Cell>
                                  {!usage.error && usage.remainingCredits > 0 ? (
                                    <Chip size="sm" variant="soft" color="success">
                                      Active
                                    </Chip>
                                  ) : !usage.error ? (
                                    <Chip size="sm" variant="soft" color="warning">
                                      Low
                                    </Chip>
                                  ) : (
                                    <Chip size="sm" variant="soft" color="danger">
                                      Error
                                    </Chip>
                                  )}
                                </Table.Cell>
                              </Table.Row>
                            );
                          })}
                          {/* Total row */}
                          <Table.Row key="total">
                            <Table.Cell className="font-bold">Total</Table.Cell>
                            <Table.Cell className="font-bold">
                              {creditUsages.reduce((total, usage) =>
                                total + (usage.error ? 0 : usage.remainingCredits), 0
                              ).toLocaleString()}
                            </Table.Cell>
                            <Table.Cell className="font-bold">-</Table.Cell>
                            <Table.Cell className="font-bold">-</Table.Cell>
                          </Table.Row>
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                )}
              </Modal.Body>

              <Modal.Footer>
                <Button variant="ghost" onPress={() => creditModalState.close()}>
                  Close
                </Button>
              </Modal.Footer>

              <Modal.CloseTrigger />
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
};
