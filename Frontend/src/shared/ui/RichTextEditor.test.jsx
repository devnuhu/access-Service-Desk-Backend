import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RichTextEditor from "./RichTextEditor.jsx";

function Editor({ onHtml = () => {} }) {
  const [html, setHtml] = useState("");
  return (
    <RichTextEditor
      id="body"
      value={html}
      onChange={(next) => {
        setHtml(next);
        onHtml(next);
      }}
    />
  );
}

const editable = () => document.getElementById("body");

function paste(target, { files = [], html = "", text = "" }) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      types: files.length ? ["Files"] : ["text/plain", "text/html"],
      getData: (type) =>
        type === "text/html" ? html : type === "text/plain" ? text : "",
    },
  });
  fireEvent(target, event);
  return event;
}

describe("RichTextEditor", () => {
  it("blocks a pasted image with the attachments hint", async () => {
    const onHtml = vi.fn();
    render(<Editor onHtml={onHtml} />);
    await screen.findByRole("toolbar", { name: "Formatting" });
    const image = new File([new Uint8Array(10)], "shot.png", {
      type: "image/png",
    });
    const event = paste(editable(), { files: [image] });
    expect(event.defaultPrevented).toBe(true);
    expect(
      await screen.findByText("Add pictures and screenshots as attachments."),
    ).toBeInTheDocument();
    expect(onHtml).not.toHaveBeenCalled();
    expect(editable().querySelector("img")).toBeNull();
  });

  it("the table button inserts a 3 x 3 table with a header row", async () => {
    const user = userEvent.setup();
    const onHtml = vi.fn();
    render(<Editor onHtml={onHtml} />);
    await user.click(
      await screen.findByRole("button", { name: "Insert table" }),
    );
    await waitFor(() => expect(onHtml).toHaveBeenCalled());
    const html = onHtml.mock.calls.at(-1)[0];
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = doc.querySelectorAll("table tr");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelectorAll("th")).toHaveLength(3);
    expect(rows[1].querySelectorAll("td")).toHaveLength(3);
    expect(rows[2].querySelectorAll("td")).toHaveLength(3);
    // The parent re-rendered with the new HTML: the editable area keeps its id and roles.
    expect(editable()).toHaveAttribute("role", "textbox");
    expect(editable()).toHaveAttribute("aria-multiline", "true");
    // In a table now: the table options open, insert is off.
    expect(screen.getByRole("button", { name: "Insert table" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Table options" })).toBeEnabled();
  });

  it("labels every toolbar control and keeps one Tab stop", async () => {
    render(<Editor />);
    const toolbar = await screen.findByRole("toolbar", { name: "Formatting" });
    const controls = toolbar.querySelectorAll("[data-tool]");
    expect(controls.length).toBeGreaterThan(20);
    controls.forEach((control) =>
      expect(control).toHaveAttribute("aria-label"),
    );
    expect(
      [...controls].filter((control) => control.tabIndex === 0),
    ).toHaveLength(1);
  });
});
