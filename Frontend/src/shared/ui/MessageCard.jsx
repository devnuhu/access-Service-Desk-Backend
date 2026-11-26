import { Link } from "react-router-dom";
import Card from "./Card.jsx";

/** A simple centred card: no access, not found, could not load. */
export default function MessageCard({
  icon: Icon,
  title,
  children,
  linkTo = "/",
  linkText = "Go to the dashboard",
}) {
  return (
    <div className="flex justify-center py-10">
      <Card className="w-full max-w-md px-6 py-8 text-center">
        {Icon && (
          <Icon
            aria-hidden="true"
            size={36}
            className="mx-auto mb-3 text-brand-navy"
          />
        )}
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="mt-2 text-sm text-body">{children}</div>
        {linkTo && (
          <Link
            to={linkTo}
            className="mt-5 inline-block font-semibold text-brand-navy underline-offset-2 hover:underline"
          >
            {linkText}
          </Link>
        )}
      </Card>
    </div>
  );
}
