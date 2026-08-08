export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-gutter bg-background">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-lg p-xl text-center max-w-[28rem] w-full">
        <p className="text-headline-xl text-primary font-black mb-sm">404</p>
        <p className="text-headline-md text-on-surface font-bold mb-sm">Page not found</p>
        <p className="text-body-md text-on-surface-variant mb-lg">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <a
          href="/dashboard"
          className="inline-block px-lg py-md rounded-lg text-label-md text-on-primary bg-primary shadow-md hover:bg-primary-container transition-colors"
        >
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
