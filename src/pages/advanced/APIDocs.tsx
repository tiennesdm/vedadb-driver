/**
 * APIDocs - Interactive API documentation
 * Route: /api-docs
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import EndpointCard from '@/components/advanced/EndpointCard';
import type { EndpointData } from '@/components/advanced/EndpointCard';
import {
  BookOpen,
  Search,
  Key,
  AlertTriangle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  API Endpoints                                                      */
/* ------------------------------------------------------------------ */

const ENDPOINTS: EndpointData[] = [
  {
    method: 'GET',
    path: '/api/tickets',
    description: 'List all tickets with optional filtering, pagination, and sorting.',
    auth: true,
    parameters: [
      { name: 'status', type: 'string', required: false, description: 'Filter by status (open, in_progress, resolved, closed)' },
      { name: 'priority', type: 'string', required: false, description: 'Filter by priority (low, medium, high, critical)' },
      { name: 'category', type: 'string', required: false, description: 'Filter by category' },
      { name: 'assigned_to', type: 'integer', required: false, description: 'Filter by assignee user ID' },
      { name: 'page', type: 'integer', required: false, description: 'Page number (default: 1)' },
      { name: 'limit', type: 'integer', required: false, description: 'Items per page (default: 20, max: 100)' },
    ],
    responseExample: {
      success: true,
      data: [
        {
          id: 1,
          title: 'Server not responding',
          status: 'open',
          priority: 'high',
          category: 'Infrastructure',
          assigned_to: 5,
          created_at: '2024-01-15T10:30:00Z',
          updated_at: '2024-01-15T10:30:00Z',
        },
      ],
      total: 42,
      page: 1,
      limit: 20,
    },
  },
  {
    method: 'GET',
    path: '/api/tickets/:id',
    description: 'Get a single ticket by ID with all details including comments.',
    auth: true,
    parameters: [
      { name: 'id', type: 'integer', required: true, description: 'Ticket ID' },
    ],
    responseExample: {
      success: true,
      data: {
        id: 1,
        title: 'Server not responding',
        description: 'The main application server is not responding to ping requests.',
        status: 'open',
        priority: 'high',
        category: 'Infrastructure',
        ticket_type: 'incident',
        created_by: 42,
        assigned_to: 5,
        department_id: 3,
        comments: [],
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T10:30:00Z',
      },
    },
  },
  {
    method: 'POST',
    path: '/api/tickets',
    description: 'Create a new ticket.',
    auth: true,
    parameters: [],
    requestBody: {
      title: 'Printer not working',
      description: 'The office printer on floor 3 is not printing.',
      priority: 'medium',
      category: 'Hardware',
      ticket_type: 'incident',
      department_id: 2,
    },
    responseExample: {
      success: true,
      data: { id: 123, title: 'Printer not working', status: 'open' },
      message: 'Ticket created successfully',
    },
  },
  {
    method: 'PUT',
    path: '/api/tickets/:id',
    description: 'Update an existing ticket.',
    auth: true,
    parameters: [
      { name: 'id', type: 'integer', required: true, description: 'Ticket ID' },
    ],
    requestBody: {
      status: 'in_progress',
      assigned_to: 5,
      priority: 'high',
    },
    responseExample: {
      success: true,
      message: 'Ticket updated successfully',
    },
  },
  {
    method: 'DELETE',
    path: '/api/tickets/:id',
    description: 'Delete a ticket.',
    auth: true,
    parameters: [
      { name: 'id', type: 'integer', required: true, description: 'Ticket ID' },
    ],
    responseExample: {
      success: true,
      message: 'Ticket deleted successfully',
    },
  },
  {
    method: 'GET',
    path: '/api/users',
    description: 'List all users with optional filtering.',
    auth: true,
    parameters: [
      { name: 'role', type: 'string', required: false, description: 'Filter by role' },
      { name: 'department_id', type: 'integer', required: false, description: 'Filter by department' },
      { name: 'page', type: 'integer', required: false, description: 'Page number' },
      { name: 'limit', type: 'integer', required: false, description: 'Items per page' },
    ],
    responseExample: {
      success: true,
      data: [
        { id: 1, name: 'John Smith', email: 'john@company.com', role: 'admin', department_id: 1 },
      ],
      total: 15,
    },
  },
  {
    method: 'GET',
    path: '/api/users/:id',
    description: 'Get a single user by ID.',
    auth: true,
    parameters: [
      { name: 'id', type: 'integer', required: true, description: 'User ID' },
    ],
    responseExample: {
      success: true,
      data: { id: 1, name: 'John Smith', email: 'john@company.com', role: 'admin' },
    },
  },
  {
    method: 'POST',
    path: '/api/users',
    description: 'Create a new user.',
    auth: true,
    parameters: [],
    requestBody: {
      name: 'Jane Doe',
      email: 'jane@company.com',
      role: 'agent',
      department_id: 2,
      password: 'securepassword123',
    },
    responseExample: {
      success: true,
      data: { id: 16, name: 'Jane Doe', email: 'jane@company.com' },
      message: 'User created successfully',
    },
  },
  {
    method: 'PUT',
    path: '/api/users/:id',
    description: 'Update an existing user.',
    auth: true,
    parameters: [
      { name: 'id', type: 'integer', required: true, description: 'User ID' },
    ],
    requestBody: {
      name: 'John Smith Jr.',
      role: 'manager',
    },
    responseExample: {
      success: true,
      message: 'User updated successfully',
    },
  },
  {
    method: 'DELETE',
    path: '/api/users/:id',
    description: 'Delete a user.',
    auth: true,
    parameters: [
      { name: 'id', type: 'integer', required: true, description: 'User ID' },
    ],
    responseExample: {
      success: true,
      message: 'User deleted successfully',
    },
  },
  {
    method: 'GET',
    path: '/api/assets',
    description: 'List all assets with optional filtering.',
    auth: true,
    parameters: [
      { name: 'type', type: 'string', required: false, description: 'Filter by asset type' },
      { name: 'status', type: 'string', required: false, description: 'Filter by status' },
    ],
    responseExample: {
      success: true,
      data: [
        { id: 1, name: 'MacBook Pro #42', type: 'laptop', status: 'active', owner_id: 5 },
      ],
      total: 87,
    },
  },
  {
    method: 'POST',
    path: '/api/assets',
    description: 'Create a new asset.',
    auth: true,
    requestBody: {
      name: 'Dell Monitor #15',
      type: 'monitor',
      status: 'active',
      serial_number: 'SN123456789',
      owner_id: 5,
    },
    responseExample: {
      success: true,
      data: { id: 88, name: 'Dell Monitor #15' },
      message: 'Asset created successfully',
    },
  },
  {
    method: 'GET',
    path: '/api/changes',
    description: 'List all change requests.',
    auth: true,
    parameters: [
      { name: 'status', type: 'string', required: false, description: 'Filter by status' },
    ],
    responseExample: {
      success: true,
      data: [
        { id: 1, title: 'Server Upgrade', status: 'pending', priority: 'high', requester: 3 },
      ],
      total: 12,
    },
  },
  {
    method: 'POST',
    path: '/api/changes',
    description: 'Create a new change request.',
    auth: true,
    requestBody: {
      title: 'Database Migration',
      description: 'Migrate to new database server.',
      priority: 'high',
      requester: 5,
      scheduled_date: '2024-02-01T02:00:00Z',
    },
    responseExample: {
      success: true,
      data: { id: 13, title: 'Database Migration', status: 'pending' },
      message: 'Change request created',
    },
  },
  {
    method: 'GET',
    path: '/api/problems',
    description: 'List all problem records.',
    auth: true,
    parameters: [
      { name: 'status', type: 'string', required: false, description: 'Filter by status' },
    ],
    responseExample: {
      success: true,
      data: [
        { id: 1, title: 'Recurring network outage', status: 'open', root_cause: 'Faulty switch' },
      ],
      total: 8,
    },
  },
  {
    method: 'POST',
    path: '/api/comments',
    description: 'Add a comment to a ticket.',
    auth: true,
    requestBody: {
      ticket_id: 1,
      content: 'Investigating the issue...',
    },
    responseExample: {
      success: true,
      data: { id: 25, ticket_id: 1, content: 'Investigating the issue...' },
      message: 'Comment added',
    },
  },
  {
    method: 'GET',
    path: '/health',
    description: 'Health check endpoint - no authentication required.',
    auth: false,
    responseExample: {
      status: 'ok',
      timestamp: '2024-01-15T10:30:00Z',
      version: '1.0.0',
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function APIDocs() {
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const tags = ['tickets', 'users', 'assets', 'changes', 'problems', 'comments'];

  const filtered = ENDPOINTS.filter((ep) => {
    const matchesSearch =
      !search ||
      ep.path.toLowerCase().includes(search.toLowerCase()) ||
      ep.description.toLowerCase().includes(search.toLowerCase()) ||
      ep.method.toLowerCase().includes(search.toLowerCase());
    const matchesTag = !selectedTag || ep.path.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const methodCounts = ENDPOINTS.reduce(
    (acc, ep) => {
      acc[ep.method] = (acc[ep.method] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#f5f2eb] flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-[#c9a87c]" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#262626]">API Documentation</h1>
          <p className="text-xs text-[#8a8a8a]">
            {ENDPOINTS.length} endpoints - {methodCounts['GET'] || 0} GET - {methodCounts['POST'] || 0} POST - {methodCounts['PUT'] || 0} PUT - {methodCounts['DELETE'] || 0} DELETE
          </p>
        </div>
      </div>

      {/* Authentication Section */}
      <Card className="border border-[#e5e0d5] bg-white">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-md bg-amber-50 flex items-center justify-center flex-shrink-0">
              <Key className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#262626]">Authentication</h3>
              <p className="text-xs text-[#595959] mt-1">
                All API endpoints require authentication via the <code className="bg-[#f5f2eb] px-1 rounded">X-API-Key</code> header.
                Obtain your API key from the Settings page.
              </p>
              <div className="mt-2 bg-[#1e1e1e] text-[#d4d4d4] p-3 rounded-md font-mono text-[11px]">
                <span className="text-[#6a9955]">// Include in every request</span>
                <br />
                <span className="text-[#9cdcfe]">X-API-Key</span>:{' '}
                <span className="text-[#ce9178]">your_api_key_here</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search & Tags */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8a8a8a]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search endpoints..."
            className="pl-8 h-9 text-xs border-[#e5e0d5]"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
              !selectedTag
                ? 'bg-[#c9a87c] text-white'
                : 'bg-[#f5f2eb] text-[#595959] hover:bg-[#e5e0d5]'
            }`}
            onClick={() => setSelectedTag(null)}
          >
            All
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium capitalize transition-colors ${
                selectedTag === tag
                  ? 'bg-[#c9a87c] text-white'
                  : 'bg-[#f5f2eb] text-[#595959] hover:bg-[#e5e0d5]'
              }`}
              onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Endpoints */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-[#8a8a8a]">
            No endpoints match your search
          </div>
        )}
        {filtered.map((endpoint) => (
          <EndpointCard key={`${endpoint.method}-${endpoint.path}`} endpoint={endpoint} />
        ))}
      </div>

      {/* Rate Limits */}
      <Card className="border border-[#e5e0d5] bg-white">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-md bg-blue-50 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#262626]">Rate Limits</h3>
              <p className="text-xs text-[#595959] mt-1">
                API requests are limited to <strong>1000 requests per hour</strong> per API key.
                The following headers are returned with every response:
              </p>
              <div className="mt-2 space-y-1 text-[11px] font-mono text-[#595959]">
                <div className="bg-[#f5f2eb] px-2 py-1 rounded">X-RateLimit-Limit: 1000</div>
                <div className="bg-[#f5f2eb] px-2 py-1 rounded">X-RateLimit-Remaining: 999</div>
                <div className="bg-[#f5f2eb] px-2 py-1 rounded">X-RateLimit-Reset: 1705312800</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
