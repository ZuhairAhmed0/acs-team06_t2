export interface AuthenticatedUser {
  id: string;
  fullName: string;
  phone: string;
  systemRole: "USER" | "ADMIN";
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
}

export interface UserResponseData {
  id: string;
  fullName: string;
  phone: string;
  systemRole: "USER" | "ADMIN";
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
}
