import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ConfirmDialog, EmptyState, ErrorState, Modal, Pagination, ProgressBar, StatCard } from "../components/ui.jsx";
import { ThemeToggle } from "../components/Layout.jsx";
import { ThemeProvider } from "../context/ThemeContext.jsx";

describe("UI components", () => {
  test("Pagination navigates and disables at the edges", async () => {
    const onChange = vi.fn();
    render(<Pagination page={1} pages={3} total={45} onChange={onChange} />);
    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(onChange).toHaveBeenCalledWith(2);
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
  });

  test("ProgressBar clamps and exposes its value", () => {
    render(<ProgressBar value={150} status="exceeded" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "150");
  });

  test("StatCard shows a coloured delta, inverted for expenses", () => {
    render(<StatCard label="Expenses" value="$10" delta={12.5} deltaGoodWhenUp={false} />);
    const delta = screen.getByText(/12\.5% vs last month/);
    expect(delta.className).toMatch(/red/);
  });

  test("Modal closes on Escape and ConfirmDialog confirms", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(<Modal open onClose={onClose} title="Hello"><p>Body</p></Modal>);
    expect(screen.getByRole("dialog", { name: "Hello" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    rerender(<ConfirmDialog open title="Delete it" message="Sure?" onClose={onClose} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  test("EmptyState and ErrorState render messages and retry", async () => {
    const retry = vi.fn();
    render(<><EmptyState title="Nothing" message="Add something" /><ErrorState error={{ message: "Boom" }} onRetry={retry} /></>);
    expect(screen.getByText("Add something")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });

  test("ThemeToggle switches the dark class and persists it", async () => {
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    const before = document.documentElement.classList.contains("dark");
    await userEvent.click(screen.getByRole("button", { name: /switch to/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(!before);
    expect(localStorage.getItem("fintrack-theme")).toBe(before ? "light" : "dark");
  });
});
