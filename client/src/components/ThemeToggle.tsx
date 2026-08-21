import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme, ThemeMode } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const MODE_META: Record<ThemeMode, { icon: typeof Sun; label: string; shortLabel: string }> = {
  light: { icon: Sun, label: "Light mode", shortLabel: "Light" },
  dark: { icon: Moon, label: "Dark mode", shortLabel: "Dark" },
  auto: { icon: Monitor, label: "System preference", shortLabel: "Auto" },
};

interface ThemeToggleProps {
  className?: string;
  variant?: "icon" | "dropdown";
}

export default function ThemeToggle({ className, variant = "icon" }: ThemeToggleProps) {
  const { mode, setMode, cycleTheme } = useTheme();
  const { icon: Icon } = MODE_META[mode];

  if (variant === "dropdown") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "gap-2 rounded-full px-3 transition-all duration-200",
              "hover:bg-accent/80 active:scale-95",
              className
            )}
          >
            <Icon className="h-4 w-4 transition-transform duration-300" />
            <span className="text-xs font-medium">{MODE_META[mode].shortLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px] animate-in fade-in-0 zoom-in-95 duration-200">
          {(["light", "dark", "auto"] as ThemeMode[]).map((m) => {
            const { icon: MIcon, label } = MODE_META[m];
            return (
              <DropdownMenuItem
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "gap-2.5 cursor-pointer transition-colors",
                  mode === m && "bg-accent font-medium"
                )}
              >
                <MIcon className="h-4 w-4" />
                <span>{label}</span>
                {mode === m && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary animate-in zoom-in duration-200" />
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleTheme}
      className={cn(
        "relative h-9 w-9 rounded-full transition-all duration-200",
        "hover:bg-accent/80 active:scale-90",
        className
      )}
      title={MODE_META[mode].label}
      aria-label={`Switch theme: ${MODE_META[mode].label}`}
    >
      <span className="relative flex items-center justify-center">
        <Icon className="h-4 w-4 transition-all duration-300 ease-out" />
      </span>
    </Button>
  );
}
