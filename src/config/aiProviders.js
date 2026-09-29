/*
 * Every AI backend the workspace can use, described once for the server (settings
 * defaults, validation, which credentials are secret) and the admin screen (the form).
 *
 * A connection is one set of credentials. Some serve more than one service: the Mistral
 * key also runs Mistral OCR, the Google service account runs both Vertex AI and Document
 * AI, and the AWS keys run both Bedrock and Textract. Field keys are flat because
 * settings.js encrypts top-level fields only.
 *
 * Every field can also come from the environment variable named in `env`; Settings wins
 * when both are set.
 */
export const AI_CONNECTIONS = [
  {
    id: 'gemini',
    label: 'Google Gemini (AI Studio)',
    hint: 'A key from a billed Google Cloud project: on the free tier Google may use what is sent.',
    fields: [
      { key: 'geminiApiKey', label: 'API key', secret: true, required: true, env: 'GEMINI_API_KEY' },
      { key: 'geminiModel', label: 'Model', kind: 'model', env: 'GEMINI_MODEL', default: 'gemini-3.8-flash' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    fields: [
      { key: 'mistralApiKey', label: 'API key', secret: true, required: true, env: 'MISTRAL_API_KEY' },
      { key: 'mistralModel', label: 'Model', kind: 'model', env: 'MISTRAL_MODEL', default: 'mistral-small-latest', hint: 'Must read PDFs and images.' },
      { key: 'mistralOcrModel', label: 'OCR model', kind: 'model', env: 'MISTRAL_OCR_MODEL', default: 'mistral-ocr-latest' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    fields: [
      { key: 'anthropicApiKey', label: 'API key', secret: true, required: true, env: 'ANTHROPIC_API_KEY' },
      { key: 'anthropicModel', label: 'Model', kind: 'model', env: 'ANTHROPIC_MODEL', default: 'claude-opus-5-5' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    fields: [
      { key: 'openaiApiKey', label: 'API key', secret: true, required: true, env: 'OPENAI_API_KEY' },
      { key: 'openaiModel', label: 'Model', kind: 'model', env: 'OPENAI_MODEL', default: 'gpt-5.6' },
    ],
  },
  {
    id: 'azureOpenai',
    label: 'Azure OpenAI',
    fields: [
      { key: 'azureOpenaiEndpoint', label: 'Endpoint', kind: 'url', required: true, env: 'AZURE_OPENAI_ENDPOINT', placeholder: 'https://your-resource.openai.azure.com' },
      { key: 'azureOpenaiApiKey', label: 'API key', secret: true, required: true, env: 'AZURE_OPENAI_API_KEY' },
      { key: 'azureOpenaiDeployment', label: 'Deployment name', kind: 'model', required: true, env: 'AZURE_OPENAI_DEPLOYMENT', hint: 'A deployment of a model that reads PDFs and images.' },
    ],
  },
  {
    id: 'googleCloud',
    label: 'Google Cloud (Vertex AI, Document AI)',
    hint: 'A service account key (JSON) with the Vertex AI User and Document AI API User roles.',
    fields: [
      { key: 'googleServiceAccount', label: 'Service account key (JSON)', secret: true, required: true, kind: 'json', env: 'GOOGLE_SERVICE_ACCOUNT_JSON' },
      { key: 'googleProject', label: 'Project ID', env: 'GOOGLE_CLOUD_PROJECT', hint: 'Leave blank to use the service account’s project.' },
      { key: 'vertexLocation', label: 'Vertex AI location', env: 'VERTEX_LOCATION', default: 'global' },
      { key: 'vertexModel', label: 'Vertex AI model', kind: 'model', env: 'VERTEX_MODEL', default: 'gemini-3.8-flash' },
      { key: 'documentAiLocation', label: 'Document AI location', env: 'DOCUMENT_AI_LOCATION', default: 'us', hint: '“us” or “eu”.' },
      { key: 'documentAiProcessorId', label: 'Document AI processor ID', env: 'DOCUMENT_AI_PROCESSOR_ID', hint: 'An OCR processor, for the OCR step.' },
    ],
  },
  {
    id: 'aws',
    label: 'AWS (Bedrock, Textract)',
    hint: 'An IAM user allowed bedrock:InvokeModel and textract:DetectDocumentText.',
    fields: [
      { key: 'awsAccessKeyId', label: 'Access key ID', required: true, env: 'AWS_ACCESS_KEY_ID' },
      { key: 'awsSecretAccessKey', label: 'Secret access key', secret: true, required: true, env: 'AWS_SECRET_ACCESS_KEY' },
      { key: 'awsRegion', label: 'Region', env: 'AWS_REGION', default: 'us-east-1' },
      { key: 'bedrockModel', label: 'Bedrock model or inference profile ID', kind: 'model', env: 'BEDROCK_MODEL', hint: 'For the Bedrock model option. It must read PDFs and images and support tool use.' },
    ],
  },
  {
    id: 'azureDocumentIntelligence',
    label: 'Azure Document Intelligence',
    fields: [
      { key: 'azureDocumentIntelligenceEndpoint', label: 'Endpoint', kind: 'url', required: true, env: 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', placeholder: 'https://your-resource.cognitiveservices.azure.com' },
      { key: 'azureDocumentIntelligenceApiKey', label: 'API key', secret: true, required: true, env: 'AZURE_DOCUMENT_INTELLIGENCE_KEY' },
      { key: 'azureDocumentIntelligenceModel', label: 'Model', kind: 'model', env: 'AZURE_DOCUMENT_INTELLIGENCE_MODEL', default: 'prebuilt-read' },
    ],
  },
  {
    id: 'openaiCompatible',
    label: 'Self-hosted (OpenAI-compatible)',
    hint: 'Ollama, vLLM or llama.cpp serving Gemma or another open model. Most read images but not PDFs, so pair it with an OCR step.',
    fields: [
      { key: 'openaiCompatibleBaseUrl', label: 'Base URL', kind: 'url', allowHttp: true, required: true, env: 'AI_BASE_URL', placeholder: 'http://your-gpu-host:11434/v1' },
      { key: 'openaiCompatibleModel', label: 'Model', kind: 'model', required: true, env: 'AI_MODEL', placeholder: 'gemma3:27b' },
      { key: 'openaiCompatibleApiKey', label: 'API key (optional)', secret: true, env: 'AI_API_KEY' },
    ],
  },
]

/** Models that read an upload and answer in JSON. `requires` lists fields beyond the connection's own required ones. */
export const AI_MODEL_PROVIDERS = [
  { id: 'gemini', label: 'Gemini', connection: 'gemini', modelField: 'geminiModel' },
  { id: 'mistral', label: 'Mistral', connection: 'mistral', modelField: 'mistralModel' },
  { id: 'anthropic', label: 'Claude', connection: 'anthropic', modelField: 'anthropicModel' },
  { id: 'openai', label: 'OpenAI', connection: 'openai', modelField: 'openaiModel' },
  { id: 'azure-openai', label: 'Azure OpenAI', connection: 'azureOpenai', modelField: 'azureOpenaiDeployment' },
  { id: 'vertex', label: 'Gemini on Vertex AI', connection: 'googleCloud', modelField: 'vertexModel' },
  { id: 'bedrock', label: 'AWS Bedrock', connection: 'aws', modelField: 'bedrockModel', requires: ['bedrockModel'] },
  { id: 'openai-compatible', label: 'Self-hosted', connection: 'openaiCompatible', modelField: 'openaiCompatibleModel' },
]

/** Text extraction that can run before the model (see ocrMode in settings). */
export const OCR_ENGINES = [
  { id: 'mistral-ocr', label: 'Mistral OCR', connection: 'mistral' },
  { id: 'azure-document-intelligence', label: 'Azure Document Intelligence', connection: 'azureDocumentIntelligence' },
  { id: 'google-document-ai', label: 'Google Document AI', connection: 'googleCloud', requires: ['documentAiProcessorId'] },
  { id: 'aws-textract', label: 'AWS Textract', connection: 'aws', hint: 'Photos and single-page PDFs only; longer PDFs go to the model as they are.' },
]

export const AI_FIELDS = AI_CONNECTIONS.flatMap((connection) => connection.fields)
export const AI_SECRET_FIELDS = AI_FIELDS.filter((field) => field.secret).map((field) => field.key)

/**
 * Whether a model provider or OCR engine has what it needs. `has(field)` says whether a
 * field has a value from any source (form, saved setting, environment or default).
 */
export const isServiceReady = (service, has) => {
  const connection = AI_CONNECTIONS.find((entry) => entry.id === service.connection)
  const needed = [...connection.fields.filter((field) => field.required).map((field) => field.key), ...(service.requires || [])]
  return needed.every(has)
}
