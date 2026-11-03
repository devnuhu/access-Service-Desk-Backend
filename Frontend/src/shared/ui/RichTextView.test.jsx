import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import RichTextView from "./RichTextView.jsx";

describe("RichTextView", () => {
  it("strips a script, event handlers and unsafe links even if the server sent them", () => {
    const { container } = render(
      <RichTextView
        html={
          '<p onclick="alert(1)">Hello <strong>there</strong></p>' +
          "<script>alert(2)</script>" +
          '<img src="x" onerror="alert(3)">' +
          '<a href="javascript:alert(4)">bad</a> <a href="https://example.test/x">good</a>' +
          '<table><tbody><tr><th style="background-color: red">H</th></tr></tbody></table>'
        }
      />,
    );
    const box = container.firstChild;
    expect(box.querySelector("script")).toBeNull();
    expect(box.querySelector("img")).toBeNull();
    expect(box.querySelector("[onclick]")).toBeNull();
    expect(box.innerHTML).not.toMatch(/alert/);
    expect(box.querySelector("strong")).toHaveTextContent("there");
    const [bad, good] = box.querySelectorAll("a");
    expect(bad).not.toHaveAttribute("href");
    expect(good).toHaveAttribute("href", "https://example.test/x");
    expect(good).toHaveAttribute("target", "_blank");
    expect(good).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(box.querySelector("th")).toHaveStyle({
      backgroundColor: "rgb(255, 0, 0)",
    });
  });
});
