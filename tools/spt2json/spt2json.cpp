// spt2json: computes a SpeedTree (.spt) the way the client's CSpeedTreeWrapper does (static lighting, no wind,
// texture coordinates flipped for Direct3D, seed 1, the file's own size) and writes its geometry as JSON:
// branch and frond triangle strips (LOD 0), leaf cards (centre, 4 corner offsets, texcoords, map index, colour)
// and the texture file names. Coordinates are the tree's own units (centimeters, z up).
//
// Build (x86, links the client's SpeedTreeRT.lib; needs SpeedTreeRT.dll next to it or on PATH at runtime):
//   cl /nologo /O2 /EHsc /MD /I <client>\extern\include\speedtree spt2json.cpp <client>\extern\lib\SpeedTreeRT.lib
// Usage: spt2json <tree.spt> <out.json>

#include <cstdio>
#include <vector>
#include <string>
#include "SpeedTreeRT.h"

static void writeString(FILE* f, const char* s) {
    fputc('"', f);
    for (; s && *s; ++s) {
        if (*s == '"' || *s == '\\') fputc('\\', f);
        if ((unsigned char)*s >= 32) fputc(*s, f);
    }
    fputc('"', f);
}

static void writeFloats(FILE* f, const float* p, size_t n) {
    fputc('[', f);
    for (size_t i = 0; i < n; ++i) fprintf(f, i ? ",%.4g" : "%.4g", p ? p[i] : 0.0f);
    fputc(']', f);
}

static void writeIndexed(FILE* f, const char* name, const CSpeedTreeRT::SGeometry::SIndexed& g) {
    fprintf(f, "\"%s\":{\"count\":%u,\"coords\":", name, g.m_usVertexCount);
    writeFloats(f, g.m_pCoords, g.m_usVertexCount * 3);
    fprintf(f, ",\"normals\":");
    writeFloats(f, g.m_pNormals, g.m_usVertexCount * 3);
    fprintf(f, ",\"uv\":");
    writeFloats(f, g.m_pTexCoords0, g.m_usVertexCount * 2);
    fprintf(f, ",\"strips\":[");
    for (unsigned short s = 0; s < g.m_usNumStrips; ++s) {
        fprintf(f, s ? ",[" : "[");
        for (unsigned short i = 0; i < g.m_pStripLengths[s]; ++i) fprintf(f, i ? ",%u" : "%u", g.m_pStrips[s][i]);
        fputc(']', f);
    }
    fprintf(f, "]}");
}

int main(int argc, char** argv) {
    if (argc < 3) { fprintf(stderr, "usage: spt2json <tree.spt> <out.json>\n"); return 2; }
    FILE* in = fopen(argv[1], "rb");
    if (!in) { fprintf(stderr, "cannot open %s\n", argv[1]); return 1; }
    std::vector<unsigned char> data;
    unsigned char buf[65536];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), in)) > 0) data.insert(data.end(), buf, buf + n);
    fclose(in);

    CSpeedTreeRT::SetTextureFlip(true);
    CSpeedTreeRT* tree = new CSpeedTreeRT;
    if (!tree->LoadTree(data.data(), (unsigned int)data.size())) { fprintf(stderr, "LoadTree: %s\n", CSpeedTreeRT::GetCurrentError()); return 1; }
    tree->SetBranchLightingMethod(CSpeedTreeRT::LIGHT_STATIC);
    tree->SetLeafLightingMethod(CSpeedTreeRT::LIGHT_STATIC);
    tree->SetFrondLightingMethod(CSpeedTreeRT::LIGHT_STATIC);
    tree->SetBranchWindMethod(CSpeedTreeRT::WIND_NONE);
    tree->SetLeafWindMethod(CSpeedTreeRT::WIND_NONE);
    tree->SetFrondWindMethod(CSpeedTreeRT::WIND_NONE);
    tree->SetNumLeafRockingGroups(1);
    if (!tree->Compute(NULL, 1)) { fprintf(stderr, "Compute: %s\n", CSpeedTreeRT::GetCurrentError()); return 1; }

    // a camera looking along +y so the leaf corner offsets come out as upright cards
    const float camPos[3] = { 0.0f, -10000.0f, 0.0f }, camDir[3] = { 0.0f, 1.0f, 0.0f };
    CSpeedTreeRT::SetCamera(camPos, camDir);
    tree->SetLodLevel(1.0f);

    FILE* f = fopen(argv[2], "wb");
    if (!f) { fprintf(stderr, "cannot write %s\n", argv[2]); return 1; }

    CSpeedTreeRT::STextures tex;
    tree->GetTextures(tex);
    float box[6];
    tree->GetBoundingBox(box);
    fprintf(f, "{\"bounds\":");
    writeFloats(f, box, 6);
    fprintf(f, ",\"textures\":{\"branch\":");
    writeString(f, tex.m_pBranchTextureFilename);
    fprintf(f, ",\"composite\":");
    writeString(f, tex.m_pCompositeFilename);
    fprintf(f, ",\"leaves\":[");
    for (unsigned int i = 0; i < tex.m_uiLeafTextureCount; ++i) { if (i) fputc(',', f); writeString(f, tex.m_pLeafTextureFilenames[i]); }
    fprintf(f, "],\"fronds\":[");
    for (unsigned int i = 0; i < tex.m_uiFrondTextureCount; ++i) { if (i) fputc(',', f); writeString(f, tex.m_pFrondTextureFilenames[i]); }
    fprintf(f, "]},");

    CSpeedTreeRT::SGeometry geo;
    tree->GetGeometry(geo, SpeedTree_BranchGeometry | SpeedTree_FrondGeometry, 0, 0, -1);
    writeIndexed(f, "branches", geo.m_sBranches);
    fputc(',', f);
    writeIndexed(f, "fronds", geo.m_sFronds);

    CSpeedTreeRT::SGeometry leafGeo;
    tree->GetGeometry(leafGeo, SpeedTree_LeafGeometry, -1, -1, 0);
    const CSpeedTreeRT::SGeometry::SLeaf& L = leafGeo.m_sLeaves0;
    fprintf(f, ",\"leaves\":[");
    for (unsigned short i = 0; i < L.m_usLeafCount; ++i) {
        if (i) fputc(',', f);
        fprintf(f, "{\"c\":");
        writeFloats(f, &L.m_pCenterCoords[i * 3], 3);
        const float* m = L.m_pLeafMapCoords[i];
        const float corners[12] = { m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], m[12], m[13], m[14] };
        fprintf(f, ",\"k\":");
        writeFloats(f, corners, 12);
        fprintf(f, ",\"t\":");
        writeFloats(f, L.m_pLeafMapTexCoords[i], 8);
        fprintf(f, ",\"m\":%u,\"col\":%lu}", L.m_pLeafMapIndices ? L.m_pLeafMapIndices[i] : 0, L.m_pColors ? L.m_pColors[i] : 0xffffffffUL);
    }
    fprintf(f, "]}");
    fclose(f);
    delete tree;
    return 0;
}
