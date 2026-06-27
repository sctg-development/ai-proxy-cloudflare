# AI Proxy Vault UI v3.0

Modern web interface for managing AI provider configurations with **multi-user and multi-vault support**.

## 🚀 Features

- ✅ **Multi-user authentication** with role-based access control
- ✅ **Isolated vaults** for each user
- ✅ **Admin dashboard** for user management
- ✅ **Legacy mode support** with automatic migration
- ✅ **Real-time vault editing** with local drafts
- ✅ **Provider model discovery** from upstream APIs
- ✅ **Drag-and-drop model prioritization**
- ✅ **BYOK (Bring Your Own Key) configuration**
- ✅ **Usage statistics and analytics**
- ✅ **Playground** for testing models

## 📋 Requirements

### Node.js version
- Node.js 18+ (recommended: 20+)
- npm 9+ or yarn 1.22+

### Environment variables

Create `.env` file in the `ui` directory:

```bash
cd ui
cp .env.example .env
```

Required variables:
```env
VITE_VAULT_URL=https://your-worker-url.workers.dev
```

## 🛠 Installation

```bash
# From project root
cd ui
npm install
```

## 🚀 Development

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 📂 Project Structure

```
ui/
├── src/
│   ├── main.tsx              # Entry point
│   ├── App.tsx               # Main application
│   ├── hooks/                # Custom hooks
│   │   └── use-ai.tsx        # AI context with user authentication
│   ├── lib/                  # Core libraries
│   │   ├── api.ts            # API client with user context
│   │   └── crypto.ts         # Encryption utilities
│   ├── components/           # UI components
│   │   ├── dashboard.tsx     # Main dashboard with RBAC
│   │   ├── login-screen.tsx  # Authentication screen
│   │   └── ui/               # Reusable UI components
│   ├── types/                # Type definitions
│   │   └── ai-config.ts      # AI configuration types
│   └── styles/               # Global styles
├── public/                   # Static assets
├── package.json
├── vite.config.ts            # Vite configuration
└── tsconfig.json
```

## 👥 Multi-User Authentication

### Login Flow

1. **Token-based authentication** using Bearer tokens
2. **Automatic user context detection**
3. **Role-based access control** (admin/user)

```typescript
// Example: Using the AI context
import { useAi } from './hooks/use-ai';

const { userContext, login, logout } = useAi();

// Login with token
await login('user_bearer_token');

// Access user information
console.log(userContext?.username);  // "ronan"
console.log(userContext?.role);      // "admin" or "user"
console.log(userContext?.vaultId);   // "vault_ronan" or "legacy"
```

### User Context Interface

```typescript
interface UserContext {
  username: string;      // User identifier
  vaultId: string;       // Associated vault ID
  role: 'admin' | 'user'; // Access level
  isLegacy: boolean;     // Legacy mode flag
}
```

## 🎨 UI Components with RBAC

### Dashboard

The main dashboard adapts based on user role:

- **Admin users**: Full access to all features
- **Regular users**: Read-only mode for shared resources

```jsx
// Role-based UI rendering
{userContext?.role !== 'admin' && (
  <Alert status="default" className="mb-6">
    <Alert.Description>
      Read-only mode. You are not an admin.
    </Alert.Description>
  </Alert>
)}
```

### Provider Management

- **Add/Edit/Delete providers** (admin only)
- **Model discovery** from provider APIs
- **Key management** with expiration tracking
- **Priority management** with drag-and-drop

### User Management (Admin only)

- **List all users**
- **Create new users**
- **Modify user roles**
- **View usage statistics**

## 🔐 Security Features

### Vault Isolation

- Each user's vault is encrypted with their own password
- Vaults are stored separately in Cloudflare KV
- Access is restricted to the vault owner only

### Role-Based Access Control

| Feature | Admin | User |
|---------|-------|------|
| Create users | ✅ | ❌ |
| Modify any vault | ✅ | ❌ |
| Access all endpoints | ✅ | ❌ |
| Modify own vault | ✅ | ✅ |
| View dashboard | ✅ | ✅ |
| Use playground | ✅ | ✅ |

### Token Management

- Secure storage in sessionStorage
- Automatic token validation
- Graceful handling of expired tokens

## 📊 Usage Examples

### Login and Access Vault

```typescript
import { useAi } from './hooks/use-ai';

// In your component
const { config, userContext, login, logout, refresh } = useAi();

// Login with user token
const handleLogin = async (token: string) => {
  try {
    await login(token);
    await refresh(); // Load user's vault
  } catch (error) {
    console.error('Login failed:', error);
  }
};

// Access configuration
useEffect(() => {
  if (config) {
    console.log('Loaded config:', config.providers);
  }
}, [config]);
```

### Create New User (Admin)

```typescript
import { ApiService } from './lib/api';

// Admin creates new user
const createUser = async (username: string, password: string) => {
  try {
    const response = await ApiService.createUser({
      username,
      password,
      role: 'user'
    });
    console.log('User created:', response);
    return response;
  } catch (error) {
    console.error('Failed to create user:', error);
    throw error;
  }
};
```

### Fetch User Context

```typescript
import { ApiService } from './lib/api';

// Get current user's context
const fetchUserContext = async () => {
  try {
    const context = await ApiService.fetchUserContext();
    console.log('User context:', context);
    return context;
  } catch (error) {
    console.error('Failed to fetch context:', error);
    return null;
  }
};
```

## 🎯 Development Workflow

### Local Development

```bash
# Start both backend and frontend
cd ..
npm run dev  # Backend (Worker)
cd ui
npm run dev  # Frontend (UI)
```

### Building for Production

```bash
# Build UI
npm run build

# Build Worker
cd ..
npm run build

# Deploy
npm run deploy
```

### Testing

```bash
# Run UI tests
npm test

# Run end-to-end tests
npm run test:e2e
```

## 🔄 Migration from Legacy

### Automatic Migration

The UI automatically detects and handles legacy mode:

1. **First login**: Checks for `/v1/auth/me` endpoint
2. **Legacy fallback**: If endpoint unavailable, assumes admin role
3. **Seamless transition**: No user intervention required

### UI Migration Indicators

- **Legacy mode banner**: Shows when running in legacy mode
- **Migration status**: Visible in user context
- **Admin warnings**: For legacy admin users

## 📝 Configuration

### Environment Variables

```env
# Required
VITE_VAULT_URL=https://your-worker-url.workers.dev

# Optional
VITE_DEBUG=true
VITE_DEFAULT_LANGUAGE=en
```

### TypeScript Configuration

- Strict type checking enabled
- ESLint for code quality
- Prettier for formatting

## 🧪 Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
npm run test:integration
```

### End-to-End Tests

```bash
npm run test:e2e
```

## 📖 API Documentation

### Authentication

- `POST /v1/auth/login` - Authenticate with token
- `POST /v1/auth/logout` - End session
- `GET /v1/auth/me` - Get current user context

### User Management (Admin)

- `GET /v1/users` - List all users
- `POST /v1/users` - Create new user
- `GET /v1/users/{username}` - Get user details
- `PUT /v1/users/{username}` - Update user
- `DELETE /v1/users/{username}` - Delete user

### Vault Management

- `GET /ai.json` - Get decrypted config
- `PUT /ai.json.enc` - Update encrypted config
- `GET /v1/keypool/byok/models` - Get BYOK config
- `POST /v1/keypool/byok/models` - Save BYOK config

## 📚 Dependencies

### Core Libraries

- **React 18+** - UI framework
- **TypeScript 5+** - Type safety
- **Vite 4+** - Build tool
- **HeroUI** - Component library
- **Lucide React** - Icons
- **Zod** - Schema validation

### Development Tools

- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Vitest** - Testing framework
- **MSW** - API mocking

## 🎨 Styling

### CSS Variables

```css
:root {
  --color-primary: #3b82f6;
  --color-secondary: #10b981;
  --color-danger: #ef4444;
  --color-warning: #f59e0b;
  --color-surface: #ffffff;
  --color-muted: #f3f4f6;
}
```

### Theme Customization

Edit `src/styles/index.css` to customize the theme.

## 🌐 Internationalization

### Language Support

- English (default)
- French (fr)
- Spanish (es)
- German (de)

### Adding New Languages

1. Create language file in `src/locales/`
2. Import in `src/i18n.ts`
3. Add language selector component

## 🚀 Deployment

### Cloudflare Pages

```bash
# Deploy UI to Cloudflare Pages
wrangler pages deploy ui/dist
```

### Vercel

```bash
# Deploy to Vercel
vercel --prod
```

### Netlify

```bash
# Deploy to Netlify
netlify deploy --prod
```

## 📜 License

AGPL-3.0-or-later

Copyright © 2024-2026 Ronan LE MEILLAT

## 🤝 Contributing

See `CONTRIBUTING.md` for contribution guidelines.

## 🙏 Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Join our Discord community
- Email: support@ai-proxy.com

---

**Happy coding!** 🎉