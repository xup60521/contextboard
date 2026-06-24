import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/test/markdown-in-whiteboard')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/test/markdown-in-whiteboard"!</div>
}
