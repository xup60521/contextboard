import { spawnSync } from 'node:child_process'

const branch =
  process.env.WORKERS_CI_BRANCH ??
  process.env.CF_PAGES_BRANCH ??
  process.env.VERCEL_GIT_COMMIT_REF ??
  process.env.GITHUB_HEAD_REF ??
  process.env.GITHUB_REF_NAME

const productionBranch =
  process.env.CONVEX_PRODUCTION_BRANCH ??
  process.env.CLOUDFLARE_PRODUCTION_BRANCH ??
  'main'

const isPreviewBranch = Boolean(branch) && branch !== productionBranch

const deployArgs = [
  'convex',
  'deploy',
  '--cmd',
  'bun run build',
  '--cmd-url-env-var-name',
  'VITE_CONVEX_URL',
]

const env = { ...process.env }

if (isPreviewBranch) {
  if (env.CONVEX_PREVIEW_DEPLOY_KEY) {
    env.CONVEX_DEPLOY_KEY = env.CONVEX_PREVIEW_DEPLOY_KEY
  } else if (env.CONVEX_DEV_DEPLOY_KEY) {
    env.CONVEX_DEPLOY_KEY = env.CONVEX_DEV_DEPLOY_KEY
  }

  if (!env.CONVEX_DEPLOY_KEY) {
    console.error(
      [
        `Cloudflare preview build for branch "${branch}" is missing Convex deployment credentials.`,
        'Set one of:',
        '  - CONVEX_PREVIEW_DEPLOY_KEY to create or reuse a Convex preview deployment per branch.',
        '  - CONVEX_DEV_DEPLOY_KEY to point all non-production branches at one shared Convex dev deployment.',
        '  - CONVEX_DEPLOY_KEY on Cloudflare\'s preview trigger if you prefer to configure the trigger directly.',
      ].join('\n'),
    )
    process.exit(1)
  }

  if (env.CONVEX_DEPLOY_KEY.startsWith('preview:')) {
    deployArgs.push('--preview-name', branch)
  }
}

const result = spawnSync('bunx', deployArgs, {
  env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
