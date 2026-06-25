export function Footer() {
  return (
    <footer className="flex items-center justify-center p-6 border-t font-light">
      <span className="text-sm text-fd-muted-foreground">
        OUITRANSFER &copy; {new Date().getFullYear()}
      </span>
    </footer>
  );
}
