import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FilePicker from "./FilePicker.jsx";

const file = (name, bytes = 10_000, type = "application/pdf") =>
  new File([new Uint8Array(bytes)], name, { type });

function Picker() {
  const [files, setFiles] = useState([]);
  return <FilePicker id="files" files={files} onChange={setFiles} />;
}

// The accept attribute would filter the .exe before the component sees it; switch that off to
// test the component's own check (a user can pick "All files" in the dialog).
const setup = () => userEvent.setup({ applyAccept: false });
const input = () => document.getElementById("files");

describe("FilePicker", () => {
  it("refuses a 7th file, a file over 1 MB and an .exe, with exact messages; removing frees a slot", async () => {
    const user = setup();
    render(<Picker />);
    expect(input()).toHaveAttribute(
      "accept",
      ".pdf,.docx,.xlsx,.csv,.jpg,.jpeg,.png",
    );

    await user.upload(
      input(),
      [1, 2, 3, 4, 5, 6].map((n) => file(`Statement ${n}.pdf`)),
    );
    expect(screen.getByText(/6 of 6 files/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose files" })).toBeDisabled();

    // Dropping a 7th
    await user.upload(input(), file("Seventh.pdf"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You can attach at most 6 files.",
    );

    await user.click(
      screen.getByRole("button", { name: "Remove Statement 2.pdf" }),
    );
    expect(screen.getByText(/5 of 6 files/)).toBeInTheDocument();

    await user.upload(input(), [
      file("Big.pdf", 2 * 1024 * 1024),
      file("setup.exe", 100, "application/x-msdownload"),
      file("Photo.png", 50_000, "image/png"),
    ]);
    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByText("Big.pdf is larger than 1 MB."),
    ).toBeInTheDocument();
    expect(
      within(alert).getByText(
        "setup.exe: only PDF, DOCX, XLSX, CSV, JPG or PNG.",
      ),
    ).toBeInTheDocument();
    // The good one took the freed slot.
    const list = screen.getByRole("list", { name: "Chosen files" });
    expect(within(list).getByText("Photo.png")).toBeInTheDocument();
    expect(within(list).getByText("49 KB")).toBeInTheDocument();
    expect(screen.getByText(/6 of 6 files/)).toBeInTheDocument();
  });

  it("shows the server's refusal under the picker", () => {
    render(
      <FilePicker
        id="files"
        files={[]}
        onChange={() => {}}
        error="Statement.pdf is not a real PDF."
      />,
    );
    expect(
      screen.getByText("Statement.pdf is not a real PDF."),
    ).toBeInTheDocument();
  });
});
