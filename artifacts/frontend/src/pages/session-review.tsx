import { Redirect, useSearch } from "wouter";

/** Legacy entry point: shift verification owns review, corrections and approval. */
export default function SessionReviewRedirect() {
  const query = new URLSearchParams(useSearch()).toString();
  return (
    <Redirect
      to={"/coordinator/verification" + (query ? "?" + query : "")}
      replace
    />
  );
}
