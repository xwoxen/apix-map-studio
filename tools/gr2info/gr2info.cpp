// gr2info: reads Granny models with the client's Granny 2.4 and prints one JSON line per file: model-space bounds
// (centimeters, z up, rest pose, all meshes), vertex/triangle counts and the diffuse / opacity texture file names.
//
// Build (x86, links the client's granny24.lib; needs granny2.dll next to it or on PATH at runtime): build.cmd
// Usage: gr2info <list.txt>     (one .gr2 path per line; output "{...}" per line, "{\"file\":...,\"error\":...}" on failure)
#include <windows.h>
#include <cstdio>
#include <cstring>
#include <cfloat>
#include <string>
#include <vector>
#include "granny24.h"

static void str(const char* s) {
	putchar('"');
	for (; s && *s; ++s) { if (*s == '"' || *s == '\\') putchar('\\'); if ((unsigned char)*s >= 32) putchar(*s); }
	putchar('"');
}

struct Info { float lo[3], hi[3]; int verts, tris, meshes; std::vector<std::string> tex; };

static void addTexture(Info& in, granny_material* m, granny_material_texture_type type) {
	granny_texture* t = m ? GrannyGetMaterialTextureByType(m, type) : nullptr;
	if (t && t->FromFileName && *t->FromFileName) {
		std::string s = t->FromFileName;
		for (auto& e : in.tex) if (e == s) return;
		in.tex.push_back(s);
	}
}

static int analyse(const char* file, Info& in) {
	granny_file* f = GrannyReadEntireFile(file);
	if (!f) return 1;
	granny_file_info* info = GrannyGetFileInfo(f);
	if (!info || info->ModelCount < 1) { GrannyFreeFile(f); return 2; }
	for (int k = 0; k < 3; ++k) { in.lo[k] = FLT_MAX; in.hi[k] = -FLT_MAX; }
	in.verts = in.tris = in.meshes = 0;
	for (int mi = 0; mi < info->ModelCount; ++mi) {
		granny_model* model = info->Models[mi];
		granny_skeleton* sk = model->Skeleton;
		if (!sk) continue;
		granny_world_pose* world = GrannyNewWorldPose(sk->BoneCount);
		granny_local_pose* local = GrannyNewLocalPose(sk->BoneCount);
		granny_model_instance* inst = GrannyInstantiateModel(model);     // no animations bound: samples the rest pose
		GrannySetModelClock(inst, 0);
		GrannySampleModelAnimations(inst, 0, sk->BoneCount, local);
		GrannyBuildWorldPose(sk, 0, sk->BoneCount, local, nullptr, world);
		GrannyFreeModelInstance(inst);
		for (int b = 0; b < model->MeshBindingCount; ++b) {
			granny_mesh* mesh = model->MeshBindings[b].Mesh;
			if (!mesh || !mesh->PrimaryVertexData) continue;
			int n = GrannyGetMeshVertexCount(mesh);
			std::vector<granny_pnt332_vertex> v(n);
			granny_mesh_binding* bind = GrannyNewMeshBinding(mesh, sk, sk);
			if (GrannyMeshIsRigid(mesh)) {
				GrannyCopyMeshVertices(mesh, GrannyPNT332VertexType, v.data());
				int bone = GrannyGetMeshBindingToBoneIndices(bind)[0];
				const float* M = GrannyGetWorldPoseComposite4x4(world, bone);
				for (auto& p : v) {
					float x = p.Position[0], y = p.Position[1], z = p.Position[2];
					p.Position[0] = x * M[0] + y * M[4] + z * M[8] + M[12];
					p.Position[1] = x * M[1] + y * M[5] + z * M[9] + M[13];
					p.Position[2] = x * M[2] + y * M[6] + z * M[10] + M[14];
				}
			} else {
				granny_mesh_deformer* d = GrannyNewMeshDeformer(GrannyGetMeshVertexType(mesh), GrannyPNT332VertexType, GrannyDeformPosition);
				if (d) {
					GrannyDeformVertices(d, GrannyGetMeshBindingToBoneIndices(bind), (float*)GrannyGetWorldPoseComposite4x4Array(world), n, GrannyGetMeshVertices(mesh), v.data());
					GrannyFreeMeshDeformer(d);
				} else GrannyCopyMeshVertices(mesh, GrannyPNT332VertexType, v.data());
			}
			GrannyFreeMeshBinding(bind);
			for (auto& p : v) for (int k = 0; k < 3; ++k) { if (p.Position[k] < in.lo[k]) in.lo[k] = p.Position[k]; if (p.Position[k] > in.hi[k]) in.hi[k] = p.Position[k]; }
			in.verts += n; in.tris += GrannyGetMeshIndexCount(mesh) / 3; in.meshes++;
			for (int m = 0; m < mesh->MaterialBindingCount; ++m) {
				granny_material* mat = mesh->MaterialBindings[m].Material;
				if (mat && mat->MapCount > 1 && mat->Name && !_strnicmp(mat->Name, "Blend", 5)) {
					addTexture(in, mat->Maps[0].Material, GrannyDiffuseColorTexture);
					addTexture(in, mat->Maps[1].Material, GrannyDiffuseColorTexture);
				} else { addTexture(in, mat, GrannyDiffuseColorTexture); addTexture(in, mat, GrannyOpacityTexture); }
			}
		}
		GrannyFreeLocalPose(local); GrannyFreeWorldPose(world);
	}
	GrannyFreeFile(f);
	return in.meshes ? 0 : 3;
}

// structured exception guard: a broken file must not stop the batch
static int guarded(const char* file, Info* in) { __try { return analyse(file, *in); } __except (EXCEPTION_EXECUTE_HANDLER) { return 9; } }

int main(int argc, char** argv) {
	setvbuf(stdout, nullptr, _IOFBF, 1 << 16);
	SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
	if (argc < 2) { puts("usage: gr2info <list.txt>"); return 2; }
	FILE* list = fopen(argv[1], "r");
	if (!list) return 3;
	char line[1024];
	while (fgets(line, sizeof line, list)) {
		line[strcspn(line, "\r\n")] = 0;
		if (!*line) continue;
		Info in;
		int r = guarded(line, &in);
		printf("{\"file\":"); str(line);
		if (r) { printf(",\"error\":%d}\n", r); continue; }
		printf(",\"min\":[%.1f,%.1f,%.1f],\"max\":[%.1f,%.1f,%.1f],\"verts\":%d,\"tris\":%d,\"meshes\":%d,\"textures\":[",
			in.lo[0], in.lo[1], in.lo[2], in.hi[0], in.hi[1], in.hi[2], in.verts, in.tris, in.meshes);
		for (size_t i = 0; i < in.tex.size(); ++i) { if (i) putchar(','); str(in.tex[i].c_str()); }
		printf("]}\n");
		fflush(stdout);
	}
	return 0;
}
