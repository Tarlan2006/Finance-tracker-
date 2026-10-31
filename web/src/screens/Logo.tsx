import logo from '../../public/icons/logo.svg?raw';

// Trusted repository SVG, inlined by Vite from the same source as the PWA icons.
// The adjacent application name already supplies the accessible label.
export default function Logo({ className = '' }: { className?: string }) {
  return <span className={`app-logo ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: logo }}/>;
}
