import { useRef, useEffect, useState } from "react";
import { useLocation } from "wouter";

interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const [location] = useLocation();
  const [isVisible, setIsVisible] = useState(true);
  const prevLocation = useRef(location);

  useEffect(() => {
    if (prevLocation.current !== location) {
      setIsVisible(false);
      const timer = setTimeout(() => {
        setIsVisible(true);
        prevLocation.current = location;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [location]);

  return (
    <div
      className="h-full transition-all duration-200 ease-out"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(4px)",
      }}
    >
      {children}
    </div>
  );
}
