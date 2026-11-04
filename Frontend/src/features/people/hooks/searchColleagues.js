import { request } from "@/shared/lib/http";
import { searchPeople } from "../api/endpoints.js";

/** The minimum the people search takes. */
export const MIN_QUERY = 2;

/** People for the shared PersonPicker ({ id, userName, fullName, department }). */
export async function searchColleagues(text) {
  const people = await request(searchPeople, { query: { query: text } });
  return people.map(({ userId, ...person }) => ({ id: userId, ...person }));
}
