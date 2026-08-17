import { describe, expect, it } from "vitest";
import { dropdownMenuItemClasses } from "./dropdown-menu";

describe("DropdownMenuItem destructive styling", () => {
  it("makes icons inherit the destructive foreground for danger actions", () => {
    expect(dropdownMenuItemClasses).toContain("data-[variant=destructive]:text-destructive");
    expect(dropdownMenuItemClasses).toContain("data-[variant=destructive]:[&_svg]:!text-destructive");
    expect(dropdownMenuItemClasses).toContain("[&.text-destructive_>_svg]:!text-destructive");
  });
});
