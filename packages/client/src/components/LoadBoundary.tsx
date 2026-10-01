import { Component, type ReactNode } from 'react';

interface LoadBoundaryProps {
  children: ReactNode;
  /** What failed to load, for the message: "the puzzle", "the console". */
  what: string;
}

interface LoadBoundaryState {
  failed: boolean;
}

/**
 * Catches a lazily loaded screen that failed to download.
 *
 * An open tab keeps the file names of the build it loaded. After a redeploy
 * (or `npm run build` on the demo machine) those files are gone, and both hosts
 * answer a missing file with index.html, so the import fails. Without a
 * boundary React would unmount the whole app and leave a blank page; this keeps
 * the rest of the page and offers a reload, which fetches the new build.
 */
export class LoadBoundary extends Component<LoadBoundaryProps, LoadBoundaryState> {
  override state: LoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): LoadBoundaryState {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card empty-state" role="alert">
        <p>Couldn’t load {this.props.what}. The site may have just been updated.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    );
  }
}
