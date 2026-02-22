import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { HeadContent, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { store } from '@/lib/store'
import AudioPlayer from '@/components/AudioPlayer'
import SettingsMenu from '@/components/SettingsMenu'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'BiniLossless',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <Provider store={store}>
          <AppShell>{children}</AppShell>
        </Provider>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}

function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const isEmbedRoute = pathname.startsWith('/embed/')

  return (
    <div className="safe-area-x safe-area-top min-h-screen relative">
      {!isEmbedRoute && (
        <div className="absolute top-4 right-4 z-[100] sm:right-6 lg:right-8">
          <SettingsMenu />
        </div>
      )}
      {children}
      <AudioPlayer headless={isEmbedRoute} />
    </div>
  )
}
