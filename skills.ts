import type { AISkill } from "mioku";
import groupAdminSkill from "./skills/group";
import personalSkill from "./skills/personal";

const adminSkills: AISkill[] = [groupAdminSkill, personalSkill];

export default adminSkills;