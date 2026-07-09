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

import React, { useEffect, useState } from 'react';
import { Button, Select, ListBox, Table, Typography } from '@heroui/react';
import { ApiService } from '../lib/api';
import * as XLSX from 'xlsx';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ApiStatsData {
  period: string;
  provider: string;
  modelId: string;
  keyOwner: string;
  keyHint: string;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
}

interface StatsData {
  period: string;
  totalRequests: number;
  totalTokens: number;
  providers: Record<string, {
    totalRequests: number;
    totalTokens: number;
  }>;
}

export const StatsPanel: React.FC = () => {
  const [apiStatsData, setApiStatsData] = useState<ApiStatsData[]>([]);
  const [statsData, setStatsData] = useState<StatsData[]>([]);
  const [timeWindow, setTimeWindow] = useState<string>('day');
  const [granularity, setGranularity] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = ApiService.getToken();
      if (!token) {
        throw new Error('No authentication token found');
      }

      let url = `${import.meta.env.VAULT_URL}/v1/keypool/stats?period=${timeWindow}`;
      if (granularity) {
        url += `&granularity=${granularity}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.status}`);
      }

      const data = await response.json();
      setApiStatsData(data.data || []);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [timeWindow, granularity]);

  useEffect(() => {
    if (apiStatsData.length === 0) {
      setStatsData([]);
      return;
    }

    const aggregatedData: Record<string, StatsData> = {};

    apiStatsData.forEach((stat) => {
      const { period, provider, promptTokens, completionTokens, requestCount } = stat;
      const totalTokens = promptTokens + completionTokens;

      if (!aggregatedData[period]) {
        aggregatedData[period] = {
          period,
          totalRequests: 0,
          totalTokens: 0,
          providers: {},
        };
      }

      aggregatedData[period].totalRequests += requestCount;
      aggregatedData[period].totalTokens += totalTokens;

      if (!aggregatedData[period].providers[provider]) {
        aggregatedData[period].providers[provider] = {
          totalRequests: 0,
          totalTokens: 0,
        };
      }

      aggregatedData[period].providers[provider].totalRequests += requestCount;
      aggregatedData[period].providers[provider].totalTokens += totalTokens;
    });

    setStatsData(Object.values(aggregatedData));
  }, [apiStatsData]);

  const exportToXLSX = () => {
    const worksheet = XLSX.utils.json_to_sheet(
      statsData.map((stat) => ({
        Period: stat.period,
        'Total Requests': stat.totalRequests,
        'Total Tokens': stat.totalTokens,
        ...Object.entries(stat.providers).reduce((acc, [provider, data]) => {
          acc[`${provider} Requests`] = data.totalRequests;
          acc[`${provider} Tokens`] = data.totalTokens;
          return acc;
        }, {} as Record<string, number>),
      }))
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Stats');
    XLSX.writeFile(workbook, `stats_${timeWindow}.xlsx`);
  };

  const chartData = statsData.map((stat) => ({
    period: stat.period,
    'Total Requests': stat.totalRequests,
    'Total Tokens': stat.totalTokens,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Typography type="h2" className="text-lg font-semibold">Usage Statistics</Typography>
        <div className="flex items-center gap-4">
          <Select
            selectedKey={timeWindow}
            onSelectionChange={(key) => setTimeWindow(key as string)}
            className="w-[200px]"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="hour" textValue="Last Hour">Last Hour</ListBox.Item>
                <ListBox.Item id="day" textValue="Last Day">Last Day</ListBox.Item>
                <ListBox.Item id="week" textValue="Last Week">Last Week</ListBox.Item>
                <ListBox.Item id="month" textValue="Last Month">Last Month</ListBox.Item>
                <ListBox.Item id="all" textValue="All Time">All Time</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <Select
            selectedKey={granularity}
            onSelectionChange={(key) => setGranularity(key as string)}
            className="w-[200px]"
          >
            <Select.Trigger>
              <Select.Value>{granularity || "Granularity"}</Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="" textValue="Default">Default</ListBox.Item>
                <ListBox.Item id="hour" textValue="Hourly">Hourly</ListBox.Item>
                <ListBox.Item id="day" textValue="Daily">Daily</ListBox.Item>
                <ListBox.Item id="week" textValue="Weekly">Weekly</ListBox.Item>
                <ListBox.Item id="month" textValue="Monthly">Monthly</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <Button size="sm" onPress={fetchStats} isPending={loading}>
            Refresh
          </Button>
          <Button size="sm" onPress={exportToXLSX}>
            Export to XLSX
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface p-4 rounded-lg shadow">
          <Typography type="h3" className="text-md font-semibold mb-4">Usage Overview</Typography>
          {loading ? (
            <div className="flex items-center justify-center h-[300px]">
              <p>Loading chart data...</p>
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              {granularity === 'hour' ? (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    stroke="#8884d8"
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#82ca9d"
                  />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="left"
                    dataKey="Total Requests"
                    stroke="#8884d8"
                    name="Total Requests"
                  />
                  <Line
                    yAxisId="right"
                    dataKey="Total Tokens"
                    stroke="#82ca9d"
                    name="Total Tokens"
                  />
                </LineChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    stroke="#8884d8"
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#82ca9d"
                  />
                  <Tooltip />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    dataKey="Total Requests"
                    fill="#8884d8"
                    name="Total Requests"
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="Total Tokens"
                    fill="#82ca9d"
                    name="Total Tokens"
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px]">
              <p>No data available for the selected period.</p>
            </div>
          )}
        </div>

        <div className="bg-surface p-4 rounded-lg shadow">
          <Typography type="h3" className="text-md font-semibold mb-4">Detailed Stats</Typography>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Detailed Stats">
                <Table.Header>
                  <Table.Column isRowHeader>Period</Table.Column>
                  <Table.Column>Total Requests</Table.Column>
                  <Table.Column>Total Tokens</Table.Column>
                </Table.Header>
                <Table.Body>
                  {statsData.length > 0 ? (
                    statsData.map((stat, index) => (
                      <Table.Row key={index}>
                        <Table.Cell>{stat.period}</Table.Cell>
                        <Table.Cell>{stat.totalRequests}</Table.Cell>
                        <Table.Cell>{stat.totalTokens}</Table.Cell>
                      </Table.Row>
                    ))
                  ) : (
                    <Table.Row>
                      <Table.Cell colSpan={3} className="text-center">No data available</Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </div>
      </div>

      <div className="bg-surface p-4 rounded-lg shadow">
        <Typography type="h3" className="text-md font-semibold mb-4">Provider Breakdown</Typography>
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Provider Breakdown">
              <Table.Header>
                <Table.Column isRowHeader>Provider</Table.Column>
                <Table.Column>Total Requests</Table.Column>
                <Table.Column>Total Tokens</Table.Column>
              </Table.Header>
              <Table.Body>
                {statsData.length > 0 && statsData[0].providers ? (
                  Object.entries(statsData[0].providers).map(([provider, data]) => (
                    <Table.Row key={provider}>
                      <Table.Cell>{provider}</Table.Cell>
                      <Table.Cell>{data.totalRequests}</Table.Cell>
                      <Table.Cell>{data.totalTokens}</Table.Cell>
                    </Table.Row>
                  ))
                ) : (
                  <Table.Row>
                    <Table.Cell colSpan={3} className="text-center">No data available</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>
    </div>
  );
};
