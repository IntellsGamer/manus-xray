import { useEffect } from "react";

/**
 * Deliberately mirrors the default HTML served by an unmodified nginx package.
 * This route remains entirely separate from the authenticated control surface.
 */
export default function Home() {
  useEffect(() => {
    document.title = "Welcome to nginx!";
  }, []);

  return (
    <main className="nginx-page">
      <section className="nginx-welcome" aria-label="nginx welcome">
        <h1>Welcome to nginx!</h1>
        <p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
        <p>
          For online documentation and support please refer to <a href="https://nginx.org/">nginx.org</a>.<br />
          Commercial support is available at <a href="https://nginx.com/">nginx.com</a>.
        </p>
        <p><em>Thank you for using nginx.</em></p>
      </section>
    </main>
  );
}
