# Plan d’action détaillé – Réécriture de `PlaygroundPanel`

## 0. Objectif global de la réécriture

Le composant actuel `PlaygroundPanel` est un composant monolithique qui gère à la fois :

- la sélection du provider ;
- la sélection du modèle ;
- la sélection de la clef API ;
- les paramètres d’inférence ;
- l’historique de chat ;
- les fichiers texte attachés ;
- l’appel HTTP au provider ;
- le rendu Markdown ;
- l’extraction de fichiers générés ;
- la génération de snippets cURL/Python/TypeScript.

La réécriture doit transformer ce composant en playground multimodal plus proche d’un Google AI Studio, tout en restant cohérent avec l’architecture actuelle du dépôt.

L’objectif n’est pas de tout mettre dans un seul fichier. Il faut conserver `playground-panel.tsx` comme conteneur principal, mais extraire les responsabilités dans des types, hooks, utilitaires et sous-composants.

---

# 1. Contraintes importantes à respecter

## 1.1 Standards du dépôt

Le code doit respecter les conventions visibles dans les fichiers existants :

- TypeScript strict.
- Noms en anglais.
- Composants React fonctionnels.
- Hooks React (`useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`).
- Imports explicites.
- Peu de commentaires inutiles.
- JSDoc uniquement pour les interfaces publiques, hooks complexes ou fonctions utilitaires non triviales.
- Code DRY : pas de duplication de logique provider/model/key.
- Style UI basé sur `@heroui/react`.
- Icônes `lucide-react`.
- Licence MIT en en-tête pour chaque nouveau fichier source important.

Exemple de style attendu :

```typescript
/**
 * Returns a stable display label for a provider API key.
 */
export const getApiKeyLabel = (apiKey: AiProvider['keys'][number]): string => {
  const ownerPrefix = apiKey.owner ? `${apiKey.owner} - ` : '';
  const typeSuffix = apiKey.type ? ` (${apiKey.type})` : '';

  return `${ownerPrefix}${maskApiKey(apiKey.key)}${typeSuffix}`;
};
```

À éviter :

```typescript
// this function makes a key label for the UI, it checks owner and type and then returns a string
function label(k: any) {
  return k.owner + k.key;
}
```

---

# 2. État actuel à préserver

Le fichier actuel fournit déjà plusieurs fonctionnalités qu’il faut conserver ou migrer proprement.

## 2.1 Sélection provider / modèle / clef

À conserver impérativement :

- `providerIds`
- `providerId`
- `modelId`
- `selectedKey`
- `AUTO_ROUND_ROBIN_KEY`
- `usableKeys`
- `chatModels`
- `resolveProviderKey`
- `autoKeyIndex`
- `lastUsedProviderKey`

La nouvelle version doit toujours permettre :

1. de choisir un provider ;
2. de choisir un modèle de type `usage === 'chat'` ;
3. de choisir une clef API précise ;
4. de choisir `Auto (round robin)` ;
5. de faire avancer l’index round-robin après chaque requête réussie ou tentée.

## 2.2 Paramètres d’inférence

À conserver :

- `systemPrompt`
- `streamEnabled`
- `temperature`
- `maxTokens`
- `topP`

À étendre plus tard si nécessaire :

- `presencePenalty`
- `frequencyPenalty`
- `stop`
- `responseModalities`

Mais ne pas ajouter ces options dans la première étape si cela complexifie trop l’implémentation.

## 2.3 Fonctionnalités actuelles de chat

À conserver ou adapter :

- affichage des messages utilisateur et assistant ;
- rendu Markdown sécurisé via `createMarkedRenderer` et `sanitizeRenderedHtml` ;
- bouton de téléchargement Markdown ;
- extraction des blocs de code via `extractGeneratedFiles` ;
- bouton `Resume from here` ;
- barre d’usage du contexte ;
- snippets équivalents cURL/Python/TypeScript.

---

# 3. Architecture cible recommandée

## 3.1 Nouvelle arborescence proposée

Créer ou modifier les fichiers suivants :

```text
ui/src/components/playground-panel.tsx
ui/src/components/playground/
  provider-model-key-selector.tsx
  generation-settings-panel.tsx
  message-list.tsx
  message-bubble.tsx
  multimodal-input.tsx
  file-preview.tsx
  text-to-speech-button.tsx
  code-block.tsx
  image-modal.tsx
  equivalent-code-panel.tsx
ui/src/hooks/
  use-playground-selection.ts
  use-playground-conversation.ts
  use-playground-indexed-db.ts
  use-playground-request.ts
ui/src/lib/playground/
  constants.ts
  payload.ts
  multimodal-files.ts
  indexed-db.ts
  tts.ts
  transcription.ts
  generated-files.ts
ui/src/types/playground-types.ts
```

Important : si le développeur junior préfère avancer progressivement, il peut commencer avec moins de fichiers, mais il faut éviter de laisser toute la logique dans `playground-panel.tsx`.

---

# 4. Nouveau modèle de données

Le type actuel est trop limité :

```typescript
export interface PlaygroundFile {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
}

export interface PlaygroundMessage {
  role: 'user' | 'assistant';
  content: string;
  files?: PlaygroundFile[];
}
```

Il faut le remplacer par un modèle capable de représenter du multimodal.

## 4.1 Types à créer dans `ui/src/types/playground-types.ts`

Plan de remplacement recommandé :

```typescript
export type PlaygroundRole = 'user' | 'assistant';

export type PlaygroundPart =
  | PlaygroundTextPart
  | PlaygroundImagePart
  | PlaygroundAudioPart
  | PlaygroundVideoPart
  | PlaygroundFilePart
  | PlaygroundCodePart
  | PlaygroundTtsAudioPart;

export interface PlaygroundTextPart {
  type: 'text';
  text: string;
}

export interface PlaygroundInlineData {
  mimeType: string;
  data: string;
}

export interface PlaygroundImagePart {
  type: 'image';
  inlineData: PlaygroundInlineData;
  name?: string;
  size?: number;
  thumbnailUrl?: string;
}

export interface PlaygroundAudioPart {
  type: 'audio';
  inlineData: PlaygroundInlineData;
  name?: string;
  size?: number;
  transcription?: string;
}

export interface PlaygroundVideoPart {
  type: 'video';
  inlineData: PlaygroundInlineData;
  name?: string;
  size?: number;
  thumbnailUrl?: string;
}

export interface PlaygroundFilePart {
  type: 'file';
  inlineData: PlaygroundInlineData;
  name: string;
  size?: number;
}

export interface PlaygroundCodePart {
  type: 'code';
  language: string;
  code: string;
  filename?: string;
}

export interface PlaygroundTtsAudioPart {
  type: 'tts_audio';
  audioUrl?: string;
  mimeType?: string;
  filename?: string;
}

export interface PlaygroundMessage {
  id: string;
  role: PlaygroundRole;
  parts: PlaygroundPart[];
  timestamp: number;
}

export interface PlaygroundConversation {
  id: string;
  title: string;
  messages: PlaygroundMessage[];
  createdAt: number;
  updatedAt: number;
}
```

## 4.2 Pourquoi garder `assistant` au lieu de `model`

Le cahier des charges propose :

```typescript
role: 'user' | 'model'
```

Mais le code actuel et l’API OpenAI-compatible utilisent déjà :

```typescript
role: 'user' | 'assistant'
```

Il est préférable de conserver `assistant` dans l’UI pour éviter des conversions inutiles. Si une API cible attend `model`, la conversion doit être faite dans `payload.ts`.

---

# 5. Étape 1 – Extraire les constantes

Créer `ui/src/lib/playground/constants.ts`.

Contenu recommandé :

```typescript
export const AUTO_ROUND_ROBIN_KEY = '__auto_round_robin__';

export const PLAYGROUND_DATABASE_NAME = 'chatbot-playground';

export const PLAYGROUND_CONVERSATION_STORE = 'conversations';

export const DEFAULT_CONVERSATION_ID = 'default';

export const MAX_INLINE_FILE_BYTES = 8 * 1024 * 1024;

export const MAX_TEXT_CONTEXT_FILE_BYTES = 256 * 1024;

export const DEFAULT_SYSTEM_PROMPT = 'You are a concise, accurate, and helpful AI assistant.';

export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

export const SUPPORTED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/flac',
  'audio/ogg',
];

export const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
];
```

Note importante : `AUTO_ROUND_ROBIN_KEY` est actuellement défini dans le composant. Il doit être déplacé pour être partagé avec le selector et le snippet panel.

---

# 6. Étape 2 – Créer un hook pour provider / modèle / clef (Model Agnostic)

Créer `ui/src/hooks/use-playground-selection.ts`.

Responsabilité du hook :

- calculer les providers disponibles ;
- maintenir `providerId` ;
- maintenir `modelId` ;
- maintenir `selectedKey`;
- maintenir `autoKeyIndex`;
- exposer `resolveProviderKey`;
- exposer `advanceRoundRobinKey`;
- exposer `lastUsedProviderKey` et `setLastUsedProviderKey`;
- **utiliser `activeConfig:AiConfig` pour tous les paramètres de modèle**.

Exemple de structure :

```typescript
export interface PlaygroundSelectionState {
  providerId: string;
  modelId: string;
  selectedKey: string;
  provider?: AiProvider;
  chatModels: AiProvider['models'];
  usableKeys: AiProvider['keys'];
  lastUsedProviderKey: string;
  setProviderId: React.Dispatch<React.SetStateAction<string>>;
  setModelId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedKey: React.Dispatch<React.SetStateAction<string>>;
  setLastUsedProviderKey: React.Dispatch<React.SetStateAction<string>>;
  resolveProviderKey: () => string;
  advanceRoundRobinKey: () => void;
  // Ajout pour accès direct à la configuration active
  activeConfig: AiConfig;
}
```

Exemple d’implémentation (Model Agnostic) :

```typescript
export const usePlaygroundSelection = (activeConfig: AiConfig): PlaygroundSelectionState => {
  const providerIds = useMemo(() => Object.keys(activeConfig.providers).sort(), [activeConfig.providers]);

  const [providerId, setProviderId] = useState<string>(providerIds[0] ?? '');
  const [modelId, setModelId] = useState<string>('');
  const [selectedKey, setSelectedKey] = useState<string>(AUTO_ROUND_ROBIN_KEY);
  const [autoKeyIndex, setAutoKeyIndex] = useState(0);
  const [lastUsedProviderKey, setLastUsedProviderKey] = useState('');

  // Utilisation de activeConfig au lieu de config
  const provider = activeConfig.providers[providerId];

  const chatModels = useMemo(() => {
    if (!provider) return [];

    // Filtrage basé sur la configuration active
    return provider.models
      .filter((model) => model.usage === 'chat')
      .slice()
      .sort((a, b) => a.priority - b.priority);
  }, [provider]);

  const usableKeys = useMemo(() => {
    if (!provider) return [];

    // Utilisation de la configuration active pour les clés
    return provider.keys.filter((apiKey) => apiKey.key.trim().length > 0);
  }, [provider]);

  useEffect(() => {
    if (providerIds.length === 0) return;

    if (!providerId || !activeConfig.providers[providerId]) {
      setProviderId(providerIds[0]);
    }
  }, [activeConfig.providers, providerId, providerIds]);

  useEffect(() => {
    if (chatModels.length === 0) {
      setModelId('');
      return;
    }

    if (!chatModels.some((model) => model.id === modelId)) {
      setModelId(chatModels[0].id);
    }
  }, [chatModels, modelId]);

  useEffect(() => {
    if (usableKeys.length === 0) {
      setSelectedKey(AUTO_ROUND_ROBIN_KEY);
      return;
    }

    if (
      selectedKey !== AUTO_ROUND_ROBIN_KEY
      && !usableKeys.some((apiKey) => apiKey.key === selectedKey)
    ) {
      setSelectedKey(AUTO_ROUND_ROBIN_KEY);
    }
  }, [selectedKey, usableKeys]);

  const resolveProviderKey = useCallback(() => {
    if (usableKeys.length === 0) return '';

    if (selectedKey === AUTO_ROUND_ROBIN_KEY) {
      return usableKeys[autoKeyIndex % usableKeys.length]?.key ?? '';
    }

    return selectedKey;
  }, [autoKeyIndex, selectedKey, usableKeys]);

  const advanceRoundRobinKey = useCallback(() => {
    if (selectedKey !== AUTO_ROUND_ROBIN_KEY || usableKeys.length === 0) return;

    setAutoKeyIndex((index) => (index + 1) % usableKeys.length);
  }, [selectedKey, usableKeys.length]);

  return {
    providerId,
    modelId,
    selectedKey,
    provider,
    chatModels,
    usableKeys,
    lastUsedProviderKey,
    setProviderId,
    setModelId,
    setSelectedKey,
    setLastUsedProviderKey,
    resolveProviderKey,
    advanceRoundRobinKey,
    // Exposition de la configuration active pour accès model-agnostic
    activeConfig
  };
};
```

---

# 7. Étape 3 – Extraire le composant provider / model / key

Créer `ui/src/components/playground/provider-model-key-selector.tsx`.

Responsabilité :

- afficher les trois `<Select>` actuels ;
- ne contenir aucune logique métier lourde ;
- recevoir les données depuis `usePlaygroundSelection`.

Props recommandées :

```typescript
export interface ProviderModelKeySelectorProps {
  providerIds: string[];
  providerId: string;
  modelId: string;
  selectedKey: string;
  chatModels: AiProvider['models'];
  usableKeys: AiProvider['keys'];
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onSelectedKeyChange: (selectedKey: string) => void;
}
```

Exemple :

```typescript
export const ProviderModelKeySelector: React.FC<ProviderModelKeySelectorProps> = ({
  providerIds,
  providerId,
  modelId,
  selectedKey,
  chatModels,
  usableKeys,
  onProviderChange,
  onModelChange,
  onSelectedKeyChange,
}) => (
  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    <Select
      className="w-full"
      placeholder="Select a provider"
      value={providerId}
      onChange={(value) => onProviderChange(String(value ?? ''))}
    >
      <Label>Provider</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {providerIds.map((id) => (
            <ListBox.Item key={id} id={id} textValue={id}>
              {id}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>

    {/* Model and API key selects follow the same pattern. */}
  </div>
);
```

Le développeur junior peut copier la logique JSX actuelle, mais doit remplacer les accès directs au state par des props.

---

# 8. Étape 4 – Créer les utilitaires fichiers multimodaux

Créer `ui/src/lib/playground/multimodal-files.ts`.

Responsabilités :

- détecter le type du fichier ;
- convertir un fichier en base64 ;
- créer des miniatures pour images ;
- créer une miniature vidéo si possible ;
- créer une `PlaygroundPart` depuis un `File`.

## 8.1 Fonctions à créer

```typescript
export const fileToBase64 = async (file: File): Promise<string> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  return dataUrl.split(',')[1] ?? '';
};
```

```typescript
export const getFileKind = (file: File): PlaygroundPart['type'] => {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';

  return 'file';
};
```

```typescript
export const createImageThumbnailUrl = (file: File): string => URL.createObjectURL(file);
```

## 8.2 Conversion complète

```typescript
export const createPartFromFile = async (file: File): Promise<PlaygroundPart> => {
  const data = await fileToBase64(file);
  const inlineData = {
    mimeType: file.type || 'application/octet-stream',
    data,
  };

  if (file.type.startsWith('image/')) {
    return {
      type: 'image',
      inlineData,
      name: file.name,
      size: file.size,
      thumbnailUrl: createImageThumbnailUrl(file),
    };
  }

  if (file.type.startsWith('audio/')) {
    return {
      type: 'audio',
      inlineData,
      name: file.name,
      size: file.size,
    };
  }

  if (file.type.startsWith('video/')) {
    return {
      type: 'video',
      inlineData,
      name: file.name,
      size: file.size,
      thumbnailUrl: URL.createObjectURL(file),
    };
  }

  return {
    type: 'file',
    inlineData,
    name: file.name,
    size: file.size,
  };
};
```

Attention : les URL créées avec `URL.createObjectURL` doivent être révoquées au démontage ou après suppression du fichier.

---

# 9. Étape 5 – Créer le composant `MultimodalInput`

Créer `ui/src/components/playground/multimodal-input.tsx`.

Responsabilités :

- champ texte ;
- ajout de fichiers ;
- drag & drop ;
- preview des fichiers ;
- suppression individuelle ;
- bouton send ;
- bouton cancel si requête en cours ;
- appel optionnel au transcriber pour les audios.

Props recommandées :

```typescript
export interface MultimodalInputProps {
  text: string;
  parts: PlaygroundPart[];
  isSending: boolean;
  onTextChange: (text: string) => void;
  onPartsChange: (parts: PlaygroundPart[]) => void;
  onSend: () => void;
  onCancel?: () => void;
}
```

La logique d’ajout :

```typescript
const addFiles = async (files: FileList | File[]) => {
  const nextParts = await Promise.all(Array.from(files).map(createPartFromFile));

  onPartsChange([...parts, ...nextParts]);
};
```

Gestion du drop :

```typescript
const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
  event.preventDefault();

  if (event.dataTransfer.files.length === 0) return;

  await addFiles(event.dataTransfer.files);
};
```

Le JSX doit rester simple :

```typescript
<div
  className="rounded-md border bg-background p-3"
  onDragOver={(event) => event.preventDefault()}
  onDrop={(event) => void handleDrop(event)}
>
  <TextArea
    rows={4}
    value={text}
    onChange={(event) => onTextChange(event.target.value)}
    placeholder="Ask something or attach images, audio, video, or files..."
  />

  <FilePreviewList
    parts={parts}
    onRemove={(index) => {
      onPartsChange(parts.filter((_, currentIndex) => currentIndex !== index));
    }}
  />

  <div className="flex justify-end gap-2">
    {isSending && onCancel && (
      <Button variant="ghost" onPress={onCancel}>
        Cancel
      </Button>
    )}

    <Button onPress={onSend} isPending={isSending}>
      <Send className="mr-2 h-4 w-4" />
      Send
    </Button>
  </div>
</div>
```

---

# 10. Étape 6 – Transcription audio

Le cahier des charges demande un service configurable. Il ne faut pas intégrer directement Google Cloud Speech-to-Text dans le composant, car ce dépôt semble être un proxy Cloudflare avec une UI de gestion de providers. Le plus propre est d’exposer une fonction optionnelle.

## 10.1 Types à ajouter

Dans `playground-types.ts` :

```typescript
export type PlaygroundTranscriber = (audio: Blob, file: File) => Promise<string>;
```

Dans `PlaygroundPanelProps` :

```typescript
export interface PlaygroundPanelProps {
  config: AiConfig;
  conversationId?: string;
  initialHistory?: PlaygroundMessage[];
  transcriber?: PlaygroundTranscriber;
  ttsProvider?: PlaygroundTtsProvider;
}
```

## 10.2 Fonction de transcription

Créer `ui/src/lib/playground/transcription.ts`.

```typescript
export const transcribeAudioParts = async (
  parts: PlaygroundPart[],
  files: File[],
  transcriber?: PlaygroundTranscriber,
): Promise<PlaygroundPart[]> => {
  if (!transcriber) return parts;

  return Promise.all(
    parts.map(async (part, index) => {
      if (part.type !== 'audio') return part;

      const file = files[index];
      if (!file) return part;

      const transcription = await transcriber(file, file);

      return {
        ...part,
        transcription,
      };
    }),
  );
};
```

À noter : cette version simple suppose que le tableau `files` est aligné avec les parts. Une version plus robuste doit associer le fichier source à l’ID de la part.

## 10.3 Comportement UX

Lorsqu’un audio est transcrit :

- afficher la transcription dans la preview ;
- ajouter un `PlaygroundTextPart` au message utilisateur si le champ texte est vide ;
- conserver l’audio attaché comme part multimodale.

Exemple :

```typescript
const buildUserParts = (text: string, attachments: PlaygroundPart[]): PlaygroundPart[] => {
  const textPart: PlaygroundTextPart | null = text.trim()
    ? { type: 'text', text: text.trim() }
    : null;

  const transcriptionParts = attachments
    .filter((part): part is PlaygroundAudioPart => part.type === 'audio' && Boolean(part.transcription))
    .map((part): PlaygroundTextPart => ({
      type: 'text',
      text: part.transcription ?? '',
    }));

  return [
    ...(textPart ? [textPart] : []),
    ...transcriptionParts,
    ...attachments,
  ];
};
```

---

# 11. Étape 7 – Construire le payload API

Créer `ui/src/lib/playground/payload.ts`.

Responsabilités :

- construire l’URL chat completions ;
- convertir `PlaygroundMessage[]` vers le format OpenAI-compatible actuel ;
- supporter les parts multimodales ;
- garder un fallback texte pour les providers ne supportant pas les parts OpenAI multimodales.

## 11.1 URL provider

Migrer la fonction actuelle :

```typescript
export const buildDirectChatUrl = (provider: AiProvider): string => {
  const base = provider.endpoint.replace(/\/+$/, '');

  if (base.endsWith('/chat/completions')) return base;

  if (/(?:\/v\d+(?:beta\d*)?)$/i.test(base)) {
    return `${base}/chat/completions`;
  }

  return `${base}/v1/chat/completions`;
};
```

## 11.2 Conversion des parts

OpenAI-compatible multimodal attendu :

```typescript
type ChatCompletionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } };
```

Mais tous les providers ne gèrent pas la même forme. Pour cette première version, faire une conversion prudente :

```typescript
export const playgroundPartsToText = (parts: PlaygroundPart[]): string => parts
  .map((part) => {
    if (part.type === 'text') return part.text;
    if (part.type === 'audio' && part.transcription) return part.transcription;
    if ('name' in part && part.name) return `[Attached ${part.type}: ${part.name}]`;

    return `[Attached ${part.type}]`;
  })
  .filter(Boolean)
  .join('\n\n');
```

Puis prévoir une fonction multimodale :

```typescript
export const playgroundPartsToOpenAiContent = (
  parts: PlaygroundPart[],
): string | Array<Record<string, unknown>> => {
  const contentParts = parts.flatMap((part): Array<Record<string, unknown>> => {
    if (part.type === 'text') {
      return [{ type: 'text', text: part.text }];
    }

    if (part.type === 'image') {
      return [{
        type: 'image_url',
        image_url: {
          url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        },
      }];
    }

    if (part.type === 'audio') {
      return [
        ...(part.transcription ? [{ type: 'text', text: part.transcription }] : []),
        {
          type: 'input_audio',
          input_audio: {
            data: part.inlineData.data,
            format: part.inlineData.mimeType.split('/')[1] ?? 'mp3',
          },
        },
      ];
    }

    return [{
      type: 'text',
      text: `[Attached ${part.type}${'name' in part && part.name ? `: ${part.name}` : ''}]`,
    }];
  });

  return contentParts.length === 1 && contentParts[0].type === 'text'
    ? String(contentParts[0].text)
    : contentParts;
};
```

## 11.3 Builder principal

```typescript
export interface BuildPlaygroundPayloadOptions {
  modelId: string;
  systemPrompt: string;
  messages: PlaygroundMessage[];
  temperature: number;
  maxTokens: number;
  topP: number;
  stream: boolean;
}

export const buildPlaygroundPayload = ({
  modelId,
  systemPrompt,
  messages,
  temperature,
  maxTokens,
  topP,
  stream,
}: BuildPlaygroundPayloadOptions) => {
  const requestMessages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: unknown;
  }> = [];

  if (systemPrompt.trim()) {
    requestMessages.push({
      role: 'system',
      content: systemPrompt.trim(),
    });
  }

  requestMessages.push(
    ...messages.map((message) => ({
      role: message.role,
      content: playgroundPartsToOpenAiContent(message.parts),
    })),
  );

  return {
    model: modelId,
    messages: requestMessages,
    temperature,
    max_tokens: maxTokens,
    top_p: topP,
    stream,
  };
};
```

---

# 12. Étape 8 – Hook de conversation

Créer `ui/src/hooks/use-playground-conversation.ts`.

Responsabilités :

- stocker `messages`;
- stocker le texte courant ;
- stocker les attachments courants ;
- gérer `resumeFromIndex`;
- construire un message utilisateur ;
- ajouter la réponse assistant ;
- reset la conversation.

Interface recommandée :

```typescript
export interface PlaygroundConversationState {
  messages: PlaygroundMessage[];
  inputText: string;
  inputParts: PlaygroundPart[];
  resumeFromIndex: number | null;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  setInputParts: React.Dispatch<React.SetStateAction<PlaygroundPart[]>>;
  setResumeFromIndex: React.Dispatch<React.SetStateAction<number | null>>;
  createNextUserMessage: () => PlaygroundMessage | null;
  replaceMessages: (messages: PlaygroundMessage[]) => void;
  appendAssistantMessage: (parts: PlaygroundPart[]) => void;
  clearDraft: () => void;
  clearConversation: () => void;
}
```

Exemple pour créer le message utilisateur :

```typescript
const createNextUserMessage = useCallback(() => {
  const parts = buildUserParts(inputText, inputParts);

  if (parts.length === 0) return null;

  return {
    id: crypto.randomUUID(),
    role: 'user',
    parts,
    timestamp: Date.now(),
  } satisfies PlaygroundMessage;
}, [inputParts, inputText]);
```

---

# 13. Étape 9 – IndexedDB

Créer `ui/src/lib/playground/indexed-db.ts`.

Utiliser idéalement `idb`. Si la dépendance n’existe pas, l’ajouter dans `ui/package.json`.

Commande à prévoir :

```bash
cd ui && npm install idb
```

## 13.1 API IndexedDB

```typescript
import { openDB } from 'idb';
import type { PlaygroundConversation } from '../../types/playground-types';
import {
  PLAYGROUND_CONVERSATION_STORE,
  PLAYGROUND_DATABASE_NAME,
} from './constants';

const getPlaygroundDb = () => openDB(PLAYGROUND_DATABASE_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(PLAYGROUND_CONVERSATION_STORE)) {
      db.createObjectStore(PLAYGROUND_CONVERSATION_STORE, { keyPath: 'id' });
    }
  },
});

export const getStoredConversation = async (
  conversationId: string,
): Promise<PlaygroundConversation | undefined> => {
  const db = await getPlaygroundDb();

  return db.get(PLAYGROUND_CONVERSATION_STORE, conversationId);
};

export const saveStoredConversation = async (
  conversation: PlaygroundConversation,
): Promise<void> => {
  const db = await getPlaygroundDb();

  await db.put(PLAYGROUND_CONVERSATION_STORE, conversation);
};

export const deleteStoredConversation = async (
  conversationId: string,
): Promise<void> => {
  const db = await getPlaygroundDb();

  await db.delete(PLAYGROUND_CONVERSATION_STORE, conversationId);
};
```

## 13.2 Hook IndexedDB

Créer `ui/src/hooks/use-playground-indexed-db.ts`.

Responsabilités :

- charger l’historique au montage ;
- appliquer `initialHistory` si aucune conversation stockée ;
- sauvegarder avec debounce 500 ms ;
- supprimer l’historique.

```typescript
export const usePlaygroundIndexedDb = ({
  conversationId,
  messages,
  initialHistory,
  onMessagesLoaded,
}: UsePlaygroundIndexedDbOptions) => {
  useEffect(() => {
    let isMounted = true;

    const loadConversation = async () => {
      const stored = await getStoredConversation(conversationId);

      if (!isMounted) return;

      if (stored) {
        onMessagesLoaded(stored.messages);
        return;
      }

      if (initialHistory?.length) {
        onMessagesLoaded(initialHistory);
      }
    };

    void loadConversation();

    return () => {
      isMounted = false;
    };
  }, [conversationId, initialHistory, onMessagesLoaded]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const now = Date.now();

      void saveStoredConversation({
        id: conversationId,
        title: getConversationTitle(messages),
        messages,
        createdAt: now,
        updatedAt: now,
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [conversationId, messages]);
};
```

Attention : éviter de sauvegarder une conversation vide au premier rendu si cela écrase `initialHistory`.

---

# 14. Étape 10 – Hook d’appel provider

Créer `ui/src/hooks/use-playground-request.ts`.

Responsabilités :

- construire le payload ;
- lancer `fetch`;
- gérer `AbortController`;
- parser streaming et JSON ;
- produire un message assistant ;
- gérer les erreurs.

## 14.1 Interface

```typescript
export interface SendPlaygroundRequestOptions {
  provider: AiProvider;
  providerKey: string;
  modelId: string;
  systemPrompt: string;
  messages: PlaygroundMessage[];
  temperature: number;
  maxTokens: number;
  topP: number;
  stream: boolean;
}

export interface PlaygroundRequestState {
  isSending: boolean;
  error: string | null;
  sendRequest: (options: SendPlaygroundRequestOptions) => Promise<PlaygroundPart[]>;
  cancelRequest: () => void;
  clearError: () => void;
}
```

## 14.2 Parser assistant

Réutiliser les fonctions actuelles, mais les déplacer dans `payload.ts` ou `request.ts` :

- `extractStreamedAssistantText`
- `extractAssistantText`

La réponse assistant devient :

```typescript
return [
  {
    type: 'text',
    text: assistantContent,
  },
];
```

Plus tard, si le provider renvoie des images base64, ajouter un parser de parts images.

## 14.3 AbortController

```typescript
const abortControllerRef = useRef<AbortController | null>(null);

const cancelRequest = useCallback(() => {
  abortControllerRef.current?.abort();
  abortControllerRef.current = null;
}, []);
```

Dans `fetch` :

```typescript
const controller = new AbortController();
abortControllerRef.current = controller;

const response = await fetch(buildDirectChatUrl(provider), {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${providerKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
  signal: controller.signal,
});
```

---

# 15. Étape 11 – Rendu des messages

Créer `ui/src/components/playground/message-list.tsx`.

```typescript
export interface MessageListProps {
  messages: PlaygroundMessage[];
  onResumeFromIndex: (index: number) => void;
}
```

```typescript
export const MessageList: React.FC<MessageListProps> = ({
  messages,
  onResumeFromIndex,
}) => {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Start the conversation by sending your first message.
      </p>
    );
  }

  return (
    <div className="mb-3 space-y-2 pr-1">
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          index={index}
          onResume={() => onResumeFromIndex(index)}
        />
      ))}
    </div>
  );
};
```

Créer `ui/src/components/playground/message-bubble.tsx`.

Responsabilités :

- rendre les parts texte Markdown ;
- rendre images ;
- rendre audio ;
- rendre vidéo ;
- rendre fichiers ;
- afficher boutons Markdown / fichiers générés / TTS / Resume.

---

# 16. Étape 12 – Rendu Markdown et blocs de code

Le dépôt possède déjà :

- `createMarkedRenderer`
- `sanitizeRenderedHtml`
- `extractGeneratedFiles`
- `getMarkdownFilename`

À court terme, continuer à utiliser ces utilitaires.

À moyen terme, remplacer `dangerouslySetInnerHTML` par `react-markdown` + `react-syntax-highlighter` si les dépendances sont acceptées.

## 16.1 Version compatible avec l’existant

```typescript
const renderMarkdown = (content: string): string => {
  const rendered = marked.parse(content);

  return sanitizeRenderedHtml(typeof rendered === 'string' ? rendered : content);
};
```

## 16.2 Composant `CodeBlock`

Créer `ui/src/components/playground/code-block.tsx`.

Ce composant peut d’abord être utilisé pour les fichiers extraits par `extractGeneratedFiles`.

```typescript
export interface CodeBlockProps {
  code: string;
  language: string;
  filename: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  filename,
}) => {
  const downloadCode = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          {language}
        </span>
        <Button size="sm" variant="ghost" onPress={downloadCode}>
          <Download className="mr-2 h-3.5 w-3.5" />
          {filename}
        </Button>
      </div>
      <pre className="overflow-auto rounded-md bg-background p-3 text-xs">
        <code>{code}</code>
      </pre>
    </div>
  );
};
```

---

# 17. Étape 13 – Text-to-Speech

## 17.1 Types

Dans `playground-types.ts` :

```typescript
export interface PlaygroundTtsResult {
  audioBlob?: Blob;
  audioUrl?: string;
  mimeType?: string;
}

export type PlaygroundTtsProvider = (text: string) => Promise<PlaygroundTtsResult>;
```

## 17.2 Implémentation par défaut Web Speech

Créer `ui/src/lib/playground/tts.ts`.

```typescript
export const speakWithWebSpeech = (text: string): Promise<void> => new Promise((resolve, reject) => {
  if (!window.speechSynthesis) {
    reject(new Error('Speech synthesis is not available in this browser.'));
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);

  utterance.onend = () => resolve();
  utterance.onerror = () => reject(new Error('Speech synthesis failed.'));

  window.speechSynthesis.speak(utterance);
});
```

## 17.3 Composant bouton

Créer `ui/src/components/playground/text-to-speech-button.tsx`.

```typescript
export interface TextToSpeechButtonProps {
  text: string;
  ttsProvider?: PlaygroundTtsProvider;
}

export const TextToSpeechButton: React.FC<TextToSpeechButtonProps> = ({
  text,
  ttsProvider,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const handlePress = async () => {
    setIsGenerating(true);

    try {
      if (ttsProvider) {
        const result = await ttsProvider(text);

        if (result.audioBlob) {
          setAudioUrl(URL.createObjectURL(result.audioBlob));
        }

        return;
      }

      await speakWithWebSpeech(text);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" isPending={isGenerating} onPress={handlePress}>
        Play audio
      </Button>

      {audioUrl && (
        <audio controls src={audioUrl}>
          <track kind="captions" />
        </audio>
      )}
    </div>
  );
};
```

---

# 18. Étape 14 – Images générées et ImageModal

Dans la première version, les images générées ne seront probablement pas renvoyées par le proxy OpenAI-compatible actuel. Il faut quand même préparer le modèle de données et le rendu.

Créer `ui/src/components/playground/image-modal.tsx`.

Fonctionnalités :

- clic sur image ;
- ouverture lightbox ;
- bouton télécharger ;
- fermeture par bouton et touche Escape.

Props :

```typescript
export interface ImageModalProps {
  imageUrl: string | null;
  filename?: string;
  onClose: () => void;
}
```

Dans `MessageBubble`, rendre une image part :

```typescript
if (part.type === 'image') {
  const imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;

  return (
    <button type="button" onClick={() => setPreviewImageUrl(imageUrl)}>
      <img
        src={imageUrl}
        alt={part.name ?? 'Generated image'}
        className="max-h-72 rounded-md border object-contain"
      />
    </button>
  );
}
```

---

# 19. Étape 15 – Equivalent Code Panel

Extraire la partie snippets dans `ui/src/components/playground/equivalent-code-panel.tsx`.

Props :

```typescript
export interface EquivalentCodePanelProps {
  provider?: AiProvider;
  providerKey: string;
  payload: unknown;
}
```

Il doit reprendre :

- `showCode`
- `snippetLanguage`
- `copiedSnippet`
- `curlSnippet`
- `pythonSnippet`
- `tsSnippet`
- `copySnippet`

Ne pas le garder dans `playground-panel.tsx`.

---

Suite du plan d’action.

---

# 20. Étape 16 – Nouveau `PlaygroundPanel`

À la fin de la réécriture, `ui/src/components/playground-panel.tsx` doit devenir un composant orchestrateur, lisible et relativement court.

Il ne doit plus contenir :

- toute la logique de sélection provider/model/key ;
- toute la logique IndexedDB ;
- toute la logique de lecture de fichiers ;
- toute la logique de payload ;
- toute la logique de rendu de messages ;
- toute la logique de snippets.

Il doit assembler les hooks et sous-composants.

## 20.1 Props finales recommandées (Model Agnostic)

```typescript
/**
 * Props for the multimodal playground panel.
 * Model-agnostic implementation using activeConfig:AiConfig from memory.
 */
export interface PlaygroundPanelProps {
  // Utilisation de la configuration active en mémoire
  activeConfig: AiConfig;
  conversationId?: string;
  initialHistory?: PlaygroundMessage[];
  transcriber?: PlaygroundTranscriber;
  ttsProvider?: PlaygroundTtsProvider;
}
```

Explication pour le développeur junior :

- **`activeConfig`** (au lieu de `config`) : Utilise la configuration active en mémoire pour tous les paramètres de modèle.
- `conversationId` permet d’avoir plusieurs conversations persistées dans IndexedDB.
- `initialHistory` permet de précharger un historique si IndexedDB ne contient rien.
- `transcriber` permet d’injecter un service speech-to-text.
- `ttsProvider` permet d’injecter un service text-to-speech téléchargeable.

**Important** : Tous les paramètres de modèle proviennent maintenant de `activeConfig:AiConfig` en mémoire, rendant l'implémentation complètement model-agnostic.

## 20.2 Structure cible du composant

Exemple de squelette :

```typescript
export const PlaygroundPanel: React.FC<PlaygroundPanelProps> = ({
  config,
  conversationId = DEFAULT_CONVERSATION_ID,
  initialHistory,
  transcriber,
  ttsProvider,
}) => {
  const selection = usePlaygroundSelection(config);
  const conversation = usePlaygroundConversation(initialHistory);
  const request = usePlaygroundRequest();

  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(512);
  const [topP, setTopP] = useState(1);

  usePlaygroundIndexedDb({
    conversationId,
    messages: conversation.messages,
    initialHistory,
    onMessagesLoaded: conversation.replaceMessages,
  });

  const payloadPreview = useMemo(() => buildPlaygroundPayload({
    modelId: selection.modelId,
    systemPrompt,
    messages: conversation.messages,
    temperature,
    maxTokens,
    topP,
    stream: streamEnabled,
  }), [
    conversation.messages,
    maxTokens,
    selection.modelId,
    streamEnabled,
    systemPrompt,
    temperature,
    topP,
  ]);

  const sendPrompt = async () => {
    const providerKey = selection.resolveProviderKey();

    if (!selection.provider) {
      request.setError('Select a provider first.');
      return;
    }

    if (!selection.modelId) {
      request.setError('Select a chat model first.');
      return;
    }

    if (!providerKey) {
      request.setError('No provider API key available.');
      return;
    }

    const nextUserMessage = conversation.createNextUserMessage();

    if (!nextUserMessage) return;

    const baseMessages = conversation.resumeFromIndex === null
      ? conversation.messages
      : conversation.messages.slice(0, conversation.resumeFromIndex + 1);

    const nextMessages = [...baseMessages, nextUserMessage];

    conversation.replaceMessages(nextMessages);
    conversation.clearDraft();
    selection.setLastUsedProviderKey(providerKey);
    selection.advanceRoundRobinKey();

    const assistantParts = await request.sendRequest({
      provider: selection.provider,
      providerKey,
      modelId: selection.modelId,
      systemPrompt,
      messages: nextMessages,
      temperature,
      maxTokens,
      topP,
      stream: streamEnabled,
    });

    conversation.replaceMessages([
      ...nextMessages,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: assistantParts,
        timestamp: Date.now(),
      },
    ]);
  };

  return (
    <div className="grid gap-6 pt-2">
      {/* Cards and sub-components go here. */}
    </div>
  );
};
```

Important : le code ci-dessus est volontairement un squelette. Pendant l’implémentation réelle, il faudra gérer les erreurs `try/catch` autour de `sendRequest`, notamment pour ajouter un message assistant d’erreur si souhaité.

---

# 21. Étape 17 – Layout final du composant

Le JSX final de `PlaygroundPanel` doit garder l’esprit de l’UI actuelle.

## 21.1 Carte principale

Elle doit contenir :

1. header avec titre ;
2. toggle streaming ;
3. bouton `New Chat` ;
4. selector provider/model/key ;
5. paramètres d’inférence ;
6. message d’erreur ;
7. usage du contexte ;
8. liste de messages ;
9. input multimodal.

Structure recommandée :

```tsx
<Card>
  <Card.Header className="flex flex-row items-center justify-between p-4">
    <div>
      <Card.Title className="flex items-center gap-2 text-lg">
        <MessageSquare className="h-5 w-5 text-primary" />
        Chat Playground
      </Card.Title>
      <Card.Description>
        Test multimodal conversations with a vault provider, then copy equivalent request code.
      </Card.Description>
    </div>

    <div className="flex items-center gap-3">
      <Checkbox
        id="playground-streaming"
        isSelected={streamEnabled}
        onChange={setStreamEnabled}
      >
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <Checkbox.Content>
          <Label htmlFor="playground-streaming">Streaming</Label>
        </Checkbox.Content>
      </Checkbox>

      <Button
        variant="ghost"
        size="sm"
        onPress={() => {
          conversation.clearConversation();
          request.clearError();
        }}
      >
        New Chat
      </Button>
    </div>
  </Card.Header>

  <Card.Content className="space-y-4 p-4">
    <ProviderModelKeySelector
      providerIds={selection.providerIds}
      providerId={selection.providerId}
      modelId={selection.modelId}
      selectedKey={selection.selectedKey}
      chatModels={selection.chatModels}
      usableKeys={selection.usableKeys}
      onProviderChange={selection.setProviderId}
      onModelChange={selection.setModelId}
      onSelectedKeyChange={selection.setSelectedKey}
    />

    <GenerationSettingsPanel
      systemPrompt={systemPrompt}
      streamEnabled={streamEnabled}
      temperature={temperature}
      maxTokens={maxTokens}
      topP={topP}
      onSystemPromptChange={setSystemPrompt}
      onTemperatureChange={setTemperature}
      onMaxTokensChange={setMaxTokens}
      onTopPChange={setTopP}
    />

    <ContextUsageBar
      messages={conversation.messages}
      draftText={conversation.inputText}
      draftParts={conversation.inputParts}
      activeModel={selection.activeModel}
      systemPrompt={systemPrompt}
    />

    <MessageList
      messages={conversation.messages}
      ttsProvider={ttsProvider}
      onResumeFromIndex={conversation.setResumeFromIndex}
    />

    <MultimodalInput
      text={conversation.inputText}
      parts={conversation.inputParts}
      isSending={request.isSending}
      transcriber={transcriber}
      onTextChange={conversation.setInputText}
      onPartsChange={conversation.setInputParts}
      onSend={() => void sendPrompt()}
      onCancel={request.cancelRequest}
    />

    {request.error && (
      <Alert status="danger">
        <Alert.Content>
          <Alert.Description>{request.error}</Alert.Description>
        </Alert.Content>
      </Alert>
    )}
  </Card.Content>
</Card>
```

Note : `ContextUsageBar` peut être créé en composant séparé ou rester dans `PlaygroundPanel` au début. Pour un junior, il est acceptable de l’extraire dans une seconde passe.

---

# 22. Étape 18 – Gestion du contexte et estimation des tokens

Le composant actuel estime les tokens ainsi :

```typescript
const estimateTokens = (text: string) => Math.ceil(text.length / 4);
```

Il faut conserver cette approche simple pour éviter d’introduire une dépendance de tokenization.

## 22.1 Nouveau helper recommandé

Créer dans `ui/src/lib/playground/payload.ts` ou `ui/src/lib/playground/context.ts` :

```typescript
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
```

Puis convertir les parts en texte :

```typescript
export const getPartTokenText = (part: PlaygroundPart): string => {
  if (part.type === 'text') return part.text;
  if (part.type === 'audio' && part.transcription) return part.transcription;
  if ('name' in part && part.name) return `[Attached ${part.type}: ${part.name}]`;

  return `[Attached ${part.type}]`;
};

export const getMessageTokenText = (message: PlaygroundMessage): string =>
  message.parts.map(getPartTokenText).join('\n\n');
```

## 22.2 Calcul de la barre de contexte

Le calcul actuel doit être adapté :

```typescript
const contextWindowTokens = Math.max(activeModel?.contextWindow ?? 1, 1);

const contextPromptTokens = contextMessages.reduce(
  (total, message) => total + estimateTokens(getMessageTokenText(message)),
  0,
);

const contextSystemTokens = systemPrompt.trim().length > 0
  ? estimateTokens(systemPrompt)
  : 0;

const contextDraftPromptTokens = estimateTokens(
  [
    inputText,
    ...inputParts.map(getPartTokenText),
  ].filter(Boolean).join('\n\n'),
);

const contextUsedTokens = contextSystemTokens + contextPromptTokens + contextDraftPromptTokens;
```

Le junior doit comprendre que c’est une estimation UX, pas une vérité API.

---

# 23. Étape 19 – Import / export JSON de l’historique

Cette fonctionnalité est indiquée comme bonus dans le cahier des charges. Il faut donc la faire après le cœur du playground.

## 23.1 Export

Créer un bouton `Export JSON`.

```typescript
const exportConversation = () => {
  const blob = new Blob([
    JSON.stringify({
      id: conversationId,
      messages,
      exportedAt: new Date().toISOString(),
    }, null, 2),
  ], {
    type: 'application/json;charset=utf-8',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `${conversationId}.json`;
  link.click();

  URL.revokeObjectURL(url);
};
```

## 23.2 Import

Créer un input file JSON caché.

Validation minimale :

```typescript
const isPlaygroundMessageArray = (value: unknown): value is PlaygroundMessage[] => {
  if (!Array.isArray(value)) return false;

  return value.every((message) => (
    typeof message === 'object'
    && message !== null
    && 'id' in message
    && 'role' in message
    && 'parts' in message
  ));
};
```

Pendant l’import, ne pas faire confiance au JSON. Afficher une erreur si la structure n’est pas valide.

---

# 24. Étape 20 – Gestion des erreurs

Le composant doit gérer les erreurs de manière claire.

## 24.1 Erreurs à prévoir

- provider non sélectionné ;
- modèle non sélectionné ;
- aucune clef disponible ;
- fichier trop volumineux ;
- type de fichier non supporté ;
- erreur de lecture fichier ;
- erreur transcription ;
- requête annulée ;
- erreur HTTP provider ;
- réponse provider non parsable ;
- IndexedDB indisponible ;
- TTS indisponible.

## 24.2 Format recommandé

Utiliser une erreur simple côté UI :

```typescript
const [error, setError] = useState<string | null>(null);
```

Pour les fonctions internes, lever des `Error` :

```typescript
if (file.size > MAX_INLINE_FILE_BYTES) {
  throw new Error(`${file.name} is larger than ${formatBytes(MAX_INLINE_FILE_BYTES)}.`);
}
```

Et afficher dans un `<Alert status="danger">`.

---

# 25. Étape 21 – Accessibilité

Le développeur junior doit traiter l’accessibilité dès l’implémentation, pas à la fin.

Checklist minimale :

- chaque bouton icône a un texte visible ou un `aria-label`;
- les inputs file cachés sont déclenchés par un bouton clair ;
- la zone drag & drop indique son rôle ;
- les images ont un `alt`;
- les audios ont un `<track kind="captions" />` même vide si nécessaire ;
- le bouton cancel est accessible au clavier ;
- la lightbox image se ferme avec `Escape`;
- les erreurs sont affichées dans une zone identifiable.

Exemple :

```tsx
<button
  type="button"
  aria-label={`Remove ${part.name}`}
  onClick={() => onRemove(index)}
>
  <X className="h-3 w-3" />
</button>
```

---

# 26. Étape 22 – Gestion mémoire des Object URLs

Les previews image / vidéo / audio peuvent utiliser `URL.createObjectURL`.

Il faut impérativement les révoquer.

## 26.1 Pattern recommandé

Dans `FilePreview` :

```typescript
useEffect(() => () => {
  if ('thumbnailUrl' in part && part.thumbnailUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(part.thumbnailUrl);
  }
}, [part]);
```

Pour les URLs audio TTS :

```typescript
useEffect(() => () => {
  if (audioUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(audioUrl);
  }
}, [audioUrl]);
```

Ne jamais révoquer une URL avant que le navigateur ait fini de l’utiliser.

---

# 27. Étape 23 – Parsing des réponses images Gemini

Dans une première version, le proxy actuel semble utiliser un endpoint OpenAI-compatible `/chat/completions`. La plupart des réponses seront textuelles.

Mais pour préparer les images générées, prévoir un parser extensible.

## 27.1 Fonction extensible

Dans `payload.ts` ou `response.ts` :

```typescript
export const extractAssistantParts = (responseBody: unknown): PlaygroundPart[] => {
  const text = extractAssistantText(responseBody);

  return text
    ? [{ type: 'text', text }]
    : [{ type: 'text', text: 'No usable assistant response.' }];
};
```

Puis plus tard, enrichir :

```typescript
interface OpenAiImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}
```

Si le provider renvoie une URL data :

```typescript
const dataUrlPattern = /^data:(?<mimeType>[^;]+);base64,(?<data>.+)$/;
```

Convertir en :

```typescript
{
  type: 'image',
  inlineData: {
    mimeType,
    data,
  },
}
```

---

# 28. Étape 24 – Ne pas intégrer directement les secrets Google Cloud

Le cahier des charges mentionne Google Cloud Speech-to-Text et Google Cloud Text-to-Speech.

Dans ce dépôt, il ne faut pas mettre de clef Google Cloud directement dans le client React.

Recommandation :

- Le composant accepte `transcriber`.
- Le composant accepte `ttsProvider`.
- L’application appelante peut utiliser un backend ou un proxy sécurisé.
- Le code client ne doit jamais contenir de secret serveur.

Exemple de mauvais code à éviter :

```typescript
const googleCloudApiKey = 'AIza...';
```

Exemple correct :

```typescript
const transcriber: PlaygroundTranscriber = async (audio) => {
  const formData = new FormData();

  formData.append('file', audio);

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json() as { text: string };

  return payload.text;
};
```

---

# 29. Étape 25 – Compatibilité avec le proxy existant

Le composant actuel appelle directement :

```typescript
fetch(buildDirectChatUrl(provider), {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${effectiveProviderKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});
```

La première version réécrite doit conserver ce comportement.

## 29.1 Attention aux fichiers multimodaux

Tous les providers OpenAI-compatible ne supportent pas :

```typescript
content: [
  { type: 'text', text: '...' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } },
]
```

Il faut donc prévoir une option interne :

```typescript
export type PlaygroundPayloadMode = 'text-only' | 'openai-multimodal';
```

Dans un premier temps, utiliser `openai-multimodal` pour les images/audio si le provider est compatible, sinon fallback `text-only`.

Simple version initiale :

```typescript
const supportsMultimodal = activeModel?.capabilities?.includes('vision') ?? false;
```

Si le type `model` ne contient pas `capabilities`, garder le fallback texte jusqu’à ce que le modèle de données provider soit enrichi.

---

# 30. Étape 26 – Migration progressive recommandée

Pour éviter de casser tout le playground d’un coup, le développeur junior doit procéder en plusieurs PR ou commits logiques.

## Commit 1 – Types et constantes

- Mettre à jour `playground-types.ts`.
- Ajouter `constants.ts`.
- Ajouter les types `PlaygroundTranscriber` et `PlaygroundTtsProvider`.

Validation :

```bash
cd ui && npm run build
```

## Commit 2 – Extraction sélection provider/model/key

- Créer `use-playground-selection.ts`.
- Créer `provider-model-key-selector.tsx`.
- Remplacer le JSX actuel par le composant extrait.
- Vérifier que la sélection fonctionne comme avant.

Validation manuelle :

- changer provider ;
- vérifier que le modèle est recalculé ;
- sélectionner une clef ;
- sélectionner round-robin ;
- envoyer un prompt texte simple.

## Commit 3 – Extraction payload/request

- Créer `payload.ts`.
- Créer `use-playground-request.ts`.
- Déplacer `buildDirectChatUrl`, `extractStreamedAssistantText`, `extractAssistantText`.
- Garder le chat texte fonctionnel.

Validation :

```bash
cd ui && npm run build
```

Puis test manuel avec un message texte simple.

## Commit 4 – Nouveau modèle de messages

- Migrer `PlaygroundMessage.content` vers `PlaygroundMessage.parts`.
- Adapter le rendu Markdown.
- Adapter l’estimation de tokens.
- Adapter l’extraction des fichiers générés.

Validation :

- envoyer un message texte ;
- recevoir une réponse ;
- télécharger Markdown ;
- télécharger code généré ;
- reprendre depuis un message.

## Commit 5 – MultimodalInput et previews

- Créer `multimodal-input.tsx`.
- Créer `file-preview.tsx`.
- Ajouter conversion base64.
- Ajouter previews image/audio/video/fichier.
- Ajouter suppression individuelle.

Validation :

- ajouter plusieurs fichiers ;
- supprimer un fichier ;
- envoyer un message avec texte + fichier ;
- vérifier absence d’erreur console.

## Commit 6 – IndexedDB

- Installer `idb`.
- Créer `indexed-db.ts`.
- Créer `use-playground-indexed-db.ts`.
- Ajouter `conversationId`.
- Ajouter `initialHistory`.

Validation :

- envoyer un message ;
- recharger la page ;
- vérifier restauration ;
- cliquer `New Chat` ;
- vérifier suppression.

## Commit 7 – TTS

- Créer `tts.ts`.
- Créer `text-to-speech-button.tsx`.
- Ajouter bouton sur chaque réponse assistant textuelle.

Validation :

- cliquer lecture ;
- vérifier Web Speech ;
- si `ttsProvider` retourne un Blob, vérifier lecteur audio et téléchargement.

## Commit 8 – Images/code avancé/import-export

- Ajouter `image-modal.tsx`.
- Ajouter import/export JSON.
- Améliorer `CodeBlock`.

Validation :

- tester lightbox ;
- exporter JSON ;
- importer JSON ;
- vérifier build.

---

# 31. Étape 27 – Tests et vérifications

Le dépôt UI doit au minimum passer :

```bash
cd ui && npm run build
```

Si un script lint existe :

```bash
cd ui && npm run lint
```

Si des tests existent :

```bash
cd ui && npm test
```

Il faut aussi vérifier le package root si pertinent :

```bash
npm test
```

## 31.1 Scénarios manuels obligatoires

### Sélection provider/model/key

- ouvrir le playground ;
- vérifier qu’un provider par défaut est sélectionné ;
- changer provider ;
- vérifier que la liste de modèles change ;
- choisir une clef précise ;
- choisir `Auto (round robin)` ;
- envoyer deux messages et vérifier que l’index avance.

### Chat texte

- envoyer un prompt simple ;
- vérifier la réponse ;
- activer/désactiver streaming ;
- télécharger la réponse Markdown.

### Fichiers

- ajouter une image ;
- ajouter un fichier texte ;
- ajouter un audio ;
- supprimer une pièce jointe ;
- envoyer avec texte + fichiers.

### Historique

- envoyer plusieurs messages ;
- recharger la page ;
- vérifier restauration IndexedDB ;
- effacer la conversation ;
- vérifier que la conversation ne revient pas au refresh.

### TTS

- cliquer sur lecture audio ;
- vérifier absence d’erreur si Web Speech est disponible ;
- vérifier message utilisateur si Web Speech indisponible.

### Accessibilité rapide

- naviguer au clavier ;
- vérifier que les boutons icônes sont lisibles ;
- vérifier les labels des champs.

---

# 32. Risques techniques et points d’attention

## 32.1 Le multimodal dépend fortement du provider

Le cahier des charges cible Gemini, mais le composant actuel utilise un proxy OpenAI-compatible. Il faut donc éviter de coder uniquement pour Gemini.

Solution :

- conserver un builder OpenAI-compatible ;
- isoler la conversion multimodale ;
- prévoir un fallback texte ;
- garder les fonctions provider-specific hors du composant React.

## 32.2 IndexedDB peut échouer

En navigation privée ou environnement restreint, IndexedDB peut être indisponible.

Solution :

- catcher les erreurs ;
- afficher une alerte non bloquante ;
- permettre au chat de fonctionner sans persistance.

## 32.3 Les fichiers base64 peuvent être lourds

Les fichiers vidéo peuvent être très volumineux.

Solution :

- définir une limite claire avec `MAX_INLINE_FILE_BYTES` ;
- refuser les fichiers trop gros ;
- afficher une erreur compréhensible ;
- envisager plus tard un upload côté serveur.

## 32.4 Web Speech ne permet pas le téléchargement

Le cahier des charges demande lecture et téléchargement audio. Web Speech permet seulement la lecture.

Solution :

- par défaut : lecture seulement ;
- si téléchargement requis : injecter `ttsProvider`;
- afficher le téléchargement seulement si un `Blob` audio existe.

## 32.5 `dangerouslySetInnerHTML`

Le code actuel utilise du HTML sanitizé. C’est acceptable si `sanitizeRenderedHtml` est robuste, mais il faut rester prudent.

Solution :

- court terme : garder l’existant ;
- moyen terme : passer à `react-markdown` avec plugins contrôlés.

---

# 33. Exemple de résultat final attendu dans `PlaygroundPanel`

Le fichier final devrait ressembler à ceci conceptuellement :

```typescript
// MIT License
// Copyright ...

import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Label } from '@heroui/react';
import { MessageSquare } from 'lucide-react';
import type { AiConfig } from '../types/ai-config';
import type {
  PlaygroundMessage,
  PlaygroundTranscriber,
  PlaygroundTtsProvider,
} from '../types/playground-types';
import { DEFAULT_CONVERSATION_ID, DEFAULT_SYSTEM_PROMPT } from '../lib/playground/constants';
import { buildPlaygroundPayload } from '../lib/playground/payload';
import { usePlaygroundSelection } from '../hooks/use-playground-selection';
import { usePlaygroundConversation } from '../hooks/use-playground-conversation';
import { usePlaygroundIndexedDb } from '../hooks/use-playground-indexed-db';
import { usePlaygroundRequest } from '../hooks/use-playground-request';
import { ProviderModelKeySelector } from './playground/provider-model-key-selector';
import { GenerationSettingsPanel } from './playground/generation-settings-panel';
import { MessageList } from './playground/message-list';
import { MultimodalInput } from './playground/multimodal-input';
import { EquivalentCodePanel } from './playground/equivalent-code-panel';

export interface PlaygroundPanelProps {
  config: AiConfig;
  conversationId?: string;
  initialHistory?: PlaygroundMessage[];
  transcriber?: PlaygroundTranscriber;
  ttsProvider?: PlaygroundTtsProvider;
}

export const PlaygroundPanel: React.FC<PlaygroundPanelProps> = ({
  config,
  conversationId = DEFAULT_CONVERSATION_ID,
  initialHistory,
  transcriber,
  ttsProvider,
}) => {
  const selection = usePlaygroundSelection(config);
  const conversation = usePlaygroundConversation(initialHistory);
  const request = usePlaygroundRequest();

  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(512);
  const [topP, setTopP] = useState(1);

  usePlaygroundIndexedDb({
    conversationId,
    messages: conversation.messages,
    initialHistory,
    onMessagesLoaded: conversation.replaceMessages,
  });

  const payloadPreview = useMemo(() => buildPlaygroundPayload({
    modelId: selection.modelId,
    systemPrompt,
    messages: conversation.previewMessages,
    temperature,
    maxTokens,
    topP,
    stream: streamEnabled,
  }), [
    conversation.previewMessages,
    maxTokens,
    selection.modelId,
    streamEnabled,
    systemPrompt,
    temperature,
    topP,
  ]);

  const sendPrompt = async () => {
    const providerKey = selection.resolveProviderKey();

    if (!selection.provider) {
      request.setError('Select a provider first.');
      return;
    }

    if (!selection.modelId) {
      request.setError('Select a chat model first.');
      return;
    }

    if (!providerKey) {
      request.setError('No provider API key available.');
      return;
    }

    const nextUserMessage = conversation.createNextUserMessage();

    if (!nextUserMessage) return;

    const baseMessages = conversation.getBaseMessages();
    const nextMessages = [...baseMessages, nextUserMessage];

    conversation.replaceMessages(nextMessages);
    conversation.clearDraft();
    selection.setLastUsedProviderKey(providerKey);
    selection.advanceRoundRobinKey();

    try {
      const assistantParts = await request.sendRequest({
        provider: selection.provider,
        providerKey,
        modelId: selection.modelId,
        systemPrompt,
        messages: nextMessages,
        temperature,
        maxTokens,
        topP,
        stream: streamEnabled,
      });

      conversation.appendAssistantMessage(assistantParts);
      conversation.setResumeFromIndex(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Playground request failed';

      conversation.appendAssistantMessage([
        {
          type: 'text',
          text: `Error: ${message}`,
        },
      ]);
    }
  };

  return (
    <div className="grid gap-6 pt-2">
      <Card>
        <Card.Header className="flex flex-row items-center justify-between p-4">
          <div>
            <Card.Title className="flex items-center gap-2 text-lg">
              <MessageSquare className="h-5 w-5 text-primary" />
              Chat Playground
            </Card.Title>
            <Card.Description>
              Test multimodal conversations with a vault provider.
            </Card.Description>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="playground-streaming"
              isSelected={streamEnabled}
              onChange={setStreamEnabled}
            >
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Content>
                <Label htmlFor="playground-streaming">Streaming</Label>
              </Checkbox.Content>
            </Checkbox>

            <Button
              variant="ghost"
              size="sm"
              onPress={conversation.clearConversation}
            >
              New Chat
            </Button>
          </div>
        </Card.Header>

        <Card.Content className="space-y-4 p-4">
          <ProviderModelKeySelector {...selection} />

          <GenerationSettingsPanel
            systemPrompt={systemPrompt}
            temperature={temperature}
            maxTokens={maxTokens}
            topP={topP}
            onSystemPromptChange={setSystemPrompt}
            onTemperatureChange={setTemperature}
            onMaxTokensChange={setMaxTokens}
            onTopPChange={setTopP}
          />

          <MessageList
            messages={conversation.messages}
            ttsProvider={ttsProvider}
            onResumeFromIndex={conversation.setResumeFromIndex}
          />

          <MultimodalInput
            text={conversation.inputText}
            parts={conversation.inputParts}
            isSending={request.isSending}
            transcriber={transcriber}
            onTextChange={conversation.setInputText}
            onPartsChange={conversation.setInputParts}
            onSend={() => void sendPrompt()}
            onCancel={request.cancelRequest}
          />

          {request.error && (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Description>{request.error}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
        </Card.Content>
      </Card>

      <EquivalentCodePanel
        provider={selection.provider}
        providerKey={selection.lastUsedProviderKey || selection.resolveProviderKey()}
        payload={payloadPreview}
      />
    </div>
  );
};
```

Important : cet exemple illustre l’objectif architectural. Il faudra ajuster certains noms selon l’implémentation réelle des hooks.

---

# 34. Checklist finale pour le développeur junior

Avant de considérer la réécriture terminée :

- [ ] `PlaygroundPanel` ne contient plus de logique métier lourde.
- [ ] La sélection provider/model/key fonctionne comme avant.
- [ ] Le mode `Auto (round robin)` fonctionne encore.
- [ ] Un prompt texte simple fonctionne.
- [ ] Le rendu Markdown fonctionne.
- [ ] Les fichiers de code générés sont téléchargeables.
- [ ] L’utilisateur peut joindre image/audio/video/fichier.
- [ ] Les previews peuvent être supprimées individuellement.
- [ ] Les fichiers trop gros sont refusés proprement.
- [ ] L’audio peut être transcrit via une prop `transcriber`.
- [ ] Les réponses assistant peuvent être lues via TTS.
- [ ] IndexedDB restaure la conversation après refresh.
- [ ] `New Chat` efface aussi IndexedDB.
- [ ] `initialHistory` est appliqué si aucune conversation stockée n’existe.
- [ ] Les erreurs provider sont visibles dans l’UI.
- [ ] L’annulation via `AbortController` fonctionne.
- [ ] `cd ui && npm run build` passe.
- [ ] Aucun secret Google Cloud n’est codé côté client.

---

# 35. Ordre de priorité recommandé

Si le temps est limité, respecter cet ordre :

1. Refactor provider/model/key sans changer le comportement.
2. Refactor request/payload sans changer le comportement.
3. Migrer `content` vers `parts`.
4. Ajouter input multimodal et previews.
5. Ajouter IndexedDB.
6. Ajouter TTS.
7. Ajouter transcription.
8. Ajouter import/export.
9. Ajouter lightbox images.
10. Améliorer le rendu code avec coloration syntaxique.

---

# 36. Décision importante à prendre avant implémentation

Avant d’écrire le code, il faut décider si la première version multimodale envoie réellement les fichiers en payload multimodal OpenAI-compatible, ou si elle commence par un fallback texte avec noms de fichiers et transcriptions.

Recommandation pragmatique :

- Phase 1 : fallback texte robuste + conservation des parts dans l’UI et IndexedDB.
- Phase 2 : payload OpenAI multimodal pour images et audio.
- Phase 3 : adaptation spécifique Gemini si le proxy expose un format Gemini natif.

Cela réduit le risque de casser le playground existant.

---

# 37. Résumé exécutable du plan

Pour un développeur junior, le chemin le plus sûr est :

1. Ne pas réécrire tout d’un coup.
2. Extraire d’abord ce qui existe déjà.
3. Vérifier à chaque étape que le chat texte fonctionne encore.
4. Introduire les nouveaux types multimodaux.
5. Ajouter les fichiers et previews.
6. Ajouter la persistance.
7. Ajouter TTS/transcription comme services injectés.
8. Garder les secrets serveur hors du client.
9. Faire passer le build après chaque étape.
