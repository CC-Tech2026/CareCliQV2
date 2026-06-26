import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type"> & {
  toggleClassName?: string;
};

export function PasswordInput({ className, toggleClassName, ...props }: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={show ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <PasswordToggleButton
        show={show}
        onToggle={() => setShow((value) => !value)}
        className={toggleClassName}
      />
    </div>
  );
}

type PasswordNativeInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  toggleClassName?: string;
  iconClassName?: string;
};

export function PasswordNativeInput({
  className,
  toggleClassName,
  iconClassName,
  ...props
}: PasswordNativeInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative w-full">
      <input
        {...props}
        type={show ? "text" : "password"}
        className={cn(className, "pr-12")}
      />
      <PasswordToggleButton
        show={show}
        onToggle={() => setShow((value) => !value)}
        className={cn("right-4", toggleClassName)}
        iconClassName={iconClassName}
      />
    </div>
  );
}

function PasswordToggleButton({
  show,
  onToggle,
  className,
  iconClassName,
}: {
  show: boolean;
  onToggle: () => void;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <button
      type="button"
      aria-label={show ? "Hide password" : "Show password"}
      onClick={onToggle}
      className={cn(
        "absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-cc-muted transition-colors hover:text-cc-plum",
        className,
      )}
    >
      {show ? (
        <EyeOff className={cn("h-4 w-4", iconClassName)} />
      ) : (
        <Eye className={cn("h-4 w-4", iconClassName)} />
      )}
    </button>
  );
}
