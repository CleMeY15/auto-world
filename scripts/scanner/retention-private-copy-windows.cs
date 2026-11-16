using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace AutoWorld.ScannerRetentionPrivateCopy {
  public sealed class Configuration {
    public readonly string Root, Sid, RootOwner, Directory;
    public Configuration(string root,string sid,string rootOwner,string directory) {
      Root=root;Sid=sid;RootOwner=rootOwner;Directory=directory;
    }
  }

  public static class Native {
    const uint Read=0x80000000,Write=0x40000000,Delete=0x10000,ReadAttributes=0x80,ReadControl=0x20000,WriteDac=0x40000,WriteOwner=0x80000,Sync=0x100000;
    const uint DirectoryAttribute=0x10,Reparse=0x400,Backup=0x02000000,OpenReparse=0x00200000;
    const uint ShareRead=1,ShareWrite=2,FileCreate=2,FileOpen=1,FileDirectory=1,NonDirectory=0x40,Synchronous=0x20,NtOpenReparse=0x200000;
    const int FileRenameInformation=10,FileDispositionInformation=13;
    const string SystemSid="S-1-5-18";
    const int FullControl=0x1f01ff;
    const long TarCap=468374629,SidecarCap=65536;
    const string RestoreManifestPath="scanner-closure/restore-manifest.json";
    static readonly string[] RestorePaths=new string[]{
      "scanner-closure/binary/trivy",
      "scanner-closure/controls/gomod/go.mod",
      "scanner-closure/controls/gomod/go.sum",
      "scanner-closure/controls/gomod/submod/go.mod",
      "scanner-closure/controls/gomod/submod/go.sum",
      "scanner-closure/controls/gomod/submod2/go.mod",
      "scanner-closure/controls/gomod/submod2/go.sum",
      "scanner-closure/controls/java/jackson-core-2.18.11.jar",
      "scanner-closure/controls/java/test.war",
      "scanner-closure/controls/manifest.json",
      "scanner-closure/inventory/go-build-info.txt",
      "scanner-closure/provenance/changed-bytes.stderr.txt",
      "scanner-closure/provenance/changed-bytes.stdout.txt",
      "scanner-closure/provenance/provenance-controls.tsv",
      "scanner-closure/provenance/received-sha256.txt",
      "scanner-closure/provenance/trivy.attestation.jsonl",
      "scanner-closure/provenance/verification-after-controls.json",
      "scanner-closure/provenance/verification-identity.json",
      "scanner-closure/provenance/verification-workflow.json",
      "scanner-closure/provenance/wrong-ref.stderr.txt",
      "scanner-closure/provenance/wrong-ref.stdout.txt",
      "scanner-closure/provenance/wrong-source.stderr.txt",
      "scanner-closure/provenance/wrong-source.stdout.txt",
      "scanner-closure/provenance/wrong-workflow.stderr.txt",
      "scanner-closure/provenance/wrong-workflow.stdout.txt",
      "scanner-closure/qualification/fixture-gomod-vulnerable-baseline.json",
      "scanner-closure/qualification/fixture-gomod-vulnerable-official.json",
      "scanner-closure/qualification/fixture-java-jar-clean-candidate-official.json",
      "scanner-closure/qualification/fixture-java-war-vulnerable-baseline.json",
      "scanner-closure/qualification/fixture-java-war-vulnerable-official.json",
      "scanner-closure/qualification/official-audit-receipt.json",
      "scanner-closure/qualification/runner-tools.txt",
      "scanner-closure/qualification/scanner-self.cdx.json",
      "scanner-closure/qualification/scanner-self.json",
      "scanner-closure/qualification/scanner-version-probe.go.mod",
      "scanner-closure/qualification/scanner-version-probe.json",
      "scanner-closure/qualification/scanner-version.txt",
      "scanner-closure/source/audit-policy.mjs",
      "scanner-closure/source/audit.mjs",
      "scanner-closure/source/controls.mjs",
      "scanner-closure/source/data-foundation-managed.yml",
      "scanner-closure/source/official-audit.mjs",
      "scanner-closure/source/official-build-info.mjs",
      "scanner-closure/source/official-controls.mjs",
      "scanner-closure/source/official-release.json",
      "scanner-closure/source/publication-binding.json",
      "scanner-closure/source/qualification-binding.json",
      "scanner-closure/source/scanner-lock.json",
      "scanner-closure/upstream/trivy_0.76.2_Linux-64bit.tar.gz",
    };

    [StructLayout(LayoutKind.Sequential)] struct Time { public uint Low,High; }
    [StructLayout(LayoutKind.Sequential)] struct Info {
      public uint Attributes;public Time Creation,Access,Written;public uint Volume,SizeHigh,SizeLow,Links,IdHigh,IdLow;
      public ulong Id { get { return ((ulong)IdHigh<<32)|IdLow; } }
      public long Size { get { return checked((long)(((ulong)SizeHigh<<32)|SizeLow)); } }
    }
    [StructLayout(LayoutKind.Sequential)] struct Unicode { public ushort Length,Maximum;public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] struct Attributes { public uint Length;public IntPtr Root,Name;public uint Flags;public IntPtr Security,Quality; }
    [StructLayout(LayoutKind.Sequential)] struct IoStatus { public IntPtr Status,Information; }

    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("ntdll.dll")] static extern int NtCreateFile(out SafeFileHandle handle,uint access,ref Attributes attributes,out IoStatus status,IntPtr allocation,uint flags,uint share,uint disposition,uint options,IntPtr ea,uint eaLength);
    [DllImport("ntdll.dll")] static extern int NtSetInformationFile(SafeFileHandle handle,out IoStatus status,IntPtr information,uint length,int informationClass);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,System.Text.StringBuilder buffer,uint count,uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle,System.Text.StringBuilder volume,uint volumeSize,out uint serial,out uint maximum,out uint flags,System.Text.StringBuilder fs,uint fsSize);
    [DllImport("kernel32.dll")] static extern uint GetFileType(SafeFileHandle handle);
    [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(SafeFileHandle handle,uint type,uint information,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetKernelObjectSecurity(IntPtr handle,uint information,byte[] descriptor);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool FlushFileBuffers(SafeFileHandle handle);

    static void Fail(string reason) { throw new InvalidOperationException("scanner_retention_private_copy_"+reason); }
    static bool Hex(string value,int length) { if(value==null||value.Length!=length)return false;foreach(char c in value)if(!(c>='0'&&c<='9'||c>='a'&&c<='f'))return false;return true; }
    static bool Leaf(string value) { if(String.IsNullOrEmpty(value)||value.Length>128)return false;foreach(char c in value)if(!(c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9'||c=='-'||c=='.'||c=='_'))return false;return value!="."&&value!=".."&&!value.EndsWith("."); }
    static bool RestoreLeaf(string value) { if(String.IsNullOrEmpty(value)||value.Length>128)return false;foreach(char c in value)if(!(c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9'||c=='-'||c=='.'||c=='_'))return false;return value!="."&&value!=".."&&!value.EndsWith("."); }
    static string TarName(string hash,bool part) { return "scanner-closure-v0.76.2-sha256-"+hash+".tar"+(part?".part":""); }
    static string SidecarName(string hash,bool part) { return "scanner-closure-v0.76.2-sha256-"+hash+".sidecar.json"+(part?".part":""); }

    static Info Information(SafeFileHandle handle,bool directory) {
      Info value=default(Info);if(handle==null||handle.IsInvalid||!GetFileInformationByHandle(handle,out value)||GetFileType(handle)!=1
        ||(value.Attributes&Reparse)!=0||((value.Attributes&DirectoryAttribute)!=0)!=directory||!directory&&value.Links!=1)Fail("identity_invalid");
      return value;
    }
    static string FinalPath(SafeFileHandle handle) {
      var buffer=new System.Text.StringBuilder(32768);uint length=GetFinalPathNameByHandleW(handle,buffer,(uint)buffer.Capacity,0);
      if(length==0||length>=buffer.Capacity)Fail("identity_invalid");return buffer.ToString();
    }
    static void Security(SafeFileHandle handle,string expectedSid,bool directory) {
      IntPtr owner,group,dacl,sacl,descriptor;if(GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor)!=0)Fail("acl_invalid");
      try {
        uint length=GetSecurityDescriptorLength(descriptor);if(length<20||length>65536)Fail("acl_invalid");
        byte[] bytes=new byte[length];Marshal.Copy(descriptor,bytes,0,bytes.Length);var security=new RawSecurityDescriptor(bytes,0);
        if(security.Owner==null||security.Owner.Value!=expectedSid||(security.ControlFlags&ControlFlags.DiscretionaryAclProtected)==0
          ||(security.ControlFlags&ControlFlags.DiscretionaryAclPresent)==0||security.DiscretionaryAcl==null||security.DiscretionaryAcl.Count!=2)Fail("acl_invalid");
        var sids=new HashSet<string>();foreach(GenericAce raw in security.DiscretionaryAcl) {
          var ace=raw as CommonAce;var expectedFlags=directory?AceFlags.ContainerInherit|AceFlags.ObjectInherit:AceFlags.None;
          if(ace==null||ace.IsCallback||ace.AceQualifier!=AceQualifier.AccessAllowed||ace.AccessMask!=FullControl||ace.AceFlags!=expectedFlags
            ||(ace.SecurityIdentifier.Value!=SystemSid&&ace.SecurityIdentifier.Value!=WindowsIdentity.GetCurrent().User.Value)||!sids.Add(ace.SecurityIdentifier.Value))Fail("acl_invalid");
        }
      } finally { if(descriptor!=IntPtr.Zero)LocalFree(descriptor); }
    }
    static byte[] Descriptor(string sid,bool directory) {
      string flags=directory?"OICI":"";var descriptor=new RawSecurityDescriptor("O:"+sid+"D:P(A;"+flags+";FA;;;"+sid+")(A;"+flags+";FA;;;SY)");
      byte[] bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);return bytes;
    }
    static void Protect(SafeFileHandle handle,string sid,bool directory) {
      byte[] descriptor=Descriptor(sid,directory);if(!SetKernelObjectSecurity(handle.DangerousGetHandle(),0x80000005,descriptor))Fail("acl_seal_failed");Security(handle,sid,directory);
    }
    static SafeFileHandle Relative(SafeFileHandle parent,string leaf,uint access,uint share,bool directory,bool create,string sid,bool allowMissing=false) {
      if(!Leaf(leaf))Fail("arguments_invalid");IntPtr name=IntPtr.Zero,unicode=IntPtr.Zero,security=IntPtr.Zero;
      try {
        name=Marshal.StringToHGlobalUni(leaf);var text=new Unicode{Length=checked((ushort)(leaf.Length*2)),Maximum=checked((ushort)((leaf.Length+1)*2)),Buffer=name};
        unicode=Marshal.AllocHGlobal(Marshal.SizeOf<Unicode>());Marshal.StructureToPtr(text,unicode,false);
        if(create){byte[] bytes=Descriptor(sid,directory);security=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,security,bytes.Length);}
        var attributes=new Attributes{Length=(uint)Marshal.SizeOf<Attributes>(),Root=parent.DangerousGetHandle(),Name=unicode,Flags=0x40|0x1000,Security=security};
        SafeFileHandle handle;IoStatus status;int result=NtCreateFile(out handle,access,ref attributes,out status,IntPtr.Zero,0,share,create?FileCreate:FileOpen,
          Synchronous|(directory?FileDirectory:NonDirectory|NtOpenReparse),IntPtr.Zero,0);
        if(allowMissing&&result==unchecked((int)0xc0000034)){if(handle!=null)handle.Dispose();return null;}
        if(result!=0||handle==null||handle.IsInvalid||(create&&status.Information.ToInt64()!=2)){if(handle!=null)handle.Dispose();Fail(create?"collision":"open_failed_"+leaf+"_"+result.ToString("x8"));}
        return handle;
      } finally {if(name!=IntPtr.Zero)Marshal.FreeHGlobal(name);if(unicode!=IntPtr.Zero)Marshal.FreeHGlobal(unicode);if(security!=IntPtr.Zero)Marshal.FreeHGlobal(security);}
    }
    static SafeFileHandle RelativeAncestor(SafeFileHandle parent,string leaf) {
      IntPtr name=Marshal.StringToHGlobalUni(leaf),unicode=Marshal.AllocHGlobal(Marshal.SizeOf<Unicode>());
      try {
        var text=new Unicode{Length=checked((ushort)(leaf.Length*2)),Maximum=checked((ushort)((leaf.Length+1)*2)),Buffer=name};Marshal.StructureToPtr(text,unicode,false);
        var attributes=new Attributes{Length=(uint)Marshal.SizeOf<Attributes>(),Root=parent.DangerousGetHandle(),Name=unicode,Flags=0x40|0x1000};
        SafeFileHandle handle;IoStatus status;int result=NtCreateFile(out handle,ReadAttributes|ReadControl|Sync,ref attributes,out status,IntPtr.Zero,0,ShareRead|ShareWrite,FileOpen,Synchronous|FileDirectory,IntPtr.Zero,0);
        if(result!=0||handle==null||handle.IsInvalid){if(handle!=null)handle.Dispose();Fail("open_failed");}return handle;
      } finally {Marshal.FreeHGlobal(name);Marshal.FreeHGlobal(unicode);}
    }

    sealed class Guard:IDisposable {
      readonly List<SafeFileHandle> handles=new List<SafeFileHandle>();readonly List<Info> identities=new List<Info>();readonly List<string> paths=new List<string>();
      public readonly Configuration Config;public SafeFileHandle Root {get{return handles[handles.Count-1];}}
      public Guard(Configuration config) {
        Config=config;
        try {
          if(Environment.OSVersion.Platform!=PlatformID.Win32NT||config==null||config.Sid!=WindowsIdentity.GetCurrent().User.Value
            ||config.Root==null||config.Root.Length<4||config.Root[1]!=':'||config.Root[2]!='\\'||config.Root.StartsWith("\\")
            ||Path.GetFullPath(config.Root)!=config.Root||config.Root.EndsWith("\\")||!Leaf(config.Directory))Fail("arguments_invalid");
          string driveRoot=config.Root.Substring(0,3);var drive=new DriveInfo(driveRoot);if(drive.DriveType!=DriveType.Fixed||drive.DriveFormat!="NTFS")Fail("filesystem_invalid");
          SafeFileHandle first=CreateFileW("\\\\?\\"+driveRoot,ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,IntPtr.Zero,3,Backup|OpenReparse,IntPtr.Zero);
          if(first.IsInvalid){first.Dispose();Fail("open_failed");}Add(first,driveRoot);
          string current=driveRoot.TrimEnd('\\');foreach(string leaf in config.Root.Substring(3).Split('\\')) {
            if(String.IsNullOrEmpty(leaf)||leaf=="."||leaf==".."||leaf.EndsWith(".")||leaf.EndsWith(" ")||leaf.Contains(":"))Fail("arguments_invalid");
            var handle=RelativeAncestor(Root,leaf);current+="\\"+leaf;Add(handle,current);
          }
          Security(Root,config.RootOwner,true);Check();
        } catch {Dispose();throw;}
      }
      void Add(SafeFileHandle handle,string expected) {
        try {
          Info info=Information(handle,true);if(!String.Equals(FinalPath(handle),"\\\\?\\"+expected,StringComparison.OrdinalIgnoreCase))Fail("identity_invalid");
          var fs=new System.Text.StringBuilder(32);uint serial,maximum,flags;
          if(!GetVolumeInformationByHandleW(handle,null,0,out serial,out maximum,out flags,fs,(uint)fs.Capacity)||fs.ToString()!="NTFS"
            ||(flags&8)==0||serial!=info.Volume||identities.Count>0&&info.Volume!=identities[0].Volume)Fail("filesystem_invalid");
          handles.Add(handle);identities.Add(info);paths.Add(expected);
        } catch {handle.Dispose();throw;}
      }
      public void Check() {
        for(int index=0;index<handles.Count;index++){Info current=Information(handles[index],true);
          if(current.Id!=identities[index].Id||current.Volume!=identities[index].Volume||!String.Equals(FinalPath(handles[index]),"\\\\?\\"+paths[index],StringComparison.OrdinalIgnoreCase))Fail("identity_changed");}
        Security(Root,Config.RootOwner,true);
      }
      public void Dispose(){for(int index=handles.Count-1;index>=0;index--)handles[index].Dispose();handles.Clear();}
    }

    static SafeFileHandle ScannerDirectory(Guard guard,bool createIfMissing) {
      guard.Check();SafeFileHandle handle=Relative(guard.Root,guard.Config.Directory,Write|ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,true,false,guard.Config.Sid,true);
      if(handle==null&&createIfMissing)handle=Relative(guard.Root,guard.Config.Directory,Write|ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,true,true,guard.Config.Sid);
      if(handle==null)Fail("open_failed");
      try {Information(handle,true);Security(handle,guard.Config.Sid,true);guard.Check();return handle;}catch{handle.Dispose();throw;}
    }
    static bool Stable(Info left,Info right) { return left.Id==right.Id&&left.Volume==right.Volume&&left.Size==right.Size&&left.Links==right.Links
      &&left.Attributes==right.Attributes&&left.Creation.Low==right.Creation.Low&&left.Creation.High==right.Creation.High&&left.Written.Low==right.Written.Low&&left.Written.High==right.Written.High; }
    static string Hash(Stream stream) { using(var hash=SHA256.Create()){return Convert.ToHexString(hash.ComputeHash(stream)).ToLowerInvariant();} }
    static FileStream BorrowedStream(SafeFileHandle handle,FileAccess access) { return new FileStream(new SafeFileHandle(handle.DangerousGetHandle(),false),access,1024*1024,false); }
    static void RequireIdentity(Info info,string volume,string fileId) {
      if(!Hex(volume,8)||!Hex(fileId,16)||info.Volume.ToString("x8")!=volume||info.Id.ToString("x16")!=fileId)Fail("identity_invalid");
    }
    static Info ValidateFile(SafeFileHandle handle,long bytes,string sha,string sid,Stream output,byte[] expected=null) {
      Info before=Information(handle,false);if(before.Size!=bytes)Fail("bytes_invalid");Security(handle,sid,false);
      using(var stream=BorrowedStream(handle,FileAccess.Read))using(var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256)) {
        byte[] buffer=new byte[1024*1024];long count=0;int read,offset=0;
        while((read=stream.Read(buffer,0,buffer.Length))!=0) {
          count+=read;if(count>bytes)Fail("bytes_invalid");hash.AppendData(buffer,0,read);
          if(expected!=null){for(int index=0;index<read;index++)if(buffer[index]!=expected[offset+index])Fail("bytes_invalid");offset+=read;}
          if(output!=null)output.Write(buffer,0,read);
        }
        if(count!=bytes||expected!=null&&offset!=expected.Length||Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()!=sha)Fail("bytes_invalid");
      }
      if(!Stable(before,Information(handle,false)))Fail("identity_changed");Security(handle,sid,false);return before;
    }
    static byte[] ReadExact(Stream input,long bytes,string sha,long cap=SidecarCap) {
      if(bytes<1||bytes>cap||bytes>Int32.MaxValue)Fail("arguments_invalid");byte[] result=new byte[checked((int)bytes)];int offset=0,read;
      using(var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256)) {
        while(offset<result.Length&&(read=input.Read(result,offset,result.Length-offset))!=0){hash.AppendData(result,offset,read);offset+=read;}
        if(offset!=result.Length||input.ReadByte()!=-1||Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()!=sha)Fail("bytes_invalid");
      }
      return result;
    }
    static Info WriteExact(SafeFileHandle directory,string name,long bytes,string sha,string sid,Stream input) {
      SafeFileHandle handle=Relative(directory,name,Read|Write|Sync,0,false,true,sid);Info created=Information(handle,false);
      try {
        Security(handle,sid,false);using(var stream=BorrowedStream(handle,FileAccess.ReadWrite))using(var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256)) {
          byte[] buffer=new byte[1024*1024];long remaining=bytes;int read;
          while(remaining>0){read=input.Read(buffer,0,(int)Math.Min(buffer.Length,remaining));if(read==0)Fail("bytes_invalid");stream.Write(buffer,0,read);hash.AppendData(buffer,0,read);remaining-=read;}
          if(input.ReadByte()!=-1||Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()!=sha)Fail("bytes_invalid");stream.Flush(true);stream.Position=0;
          if(Hash(stream)!=sha)Fail("bytes_invalid");Info final=Information(handle,false);if(final.Id!=created.Id||final.Volume!=created.Volume||final.Size!=bytes)Fail("identity_changed");Security(handle,sid,false);
        }
      } finally {handle.Dispose();}
      using(var reopened=Relative(directory,name,Read|Sync,0,false,false,sid)) {
        Info observed=ValidateFile(reopened,bytes,sha,sid,null);if(observed.Id!=created.Id||observed.Volume!=created.Volume)Fail("identity_changed");return observed;
      }
    }
    static void RequireAbsent(SafeFileHandle directory,string name,string sid) { using(var handle=Relative(directory,name,ReadAttributes|Sync,0,false,false,sid,true)){if(handle!=null)Fail("collision");} }
    static void RenameNoReplace(SafeFileHandle handle,SafeFileHandle directory,string target) {
      if(!Leaf(target))Fail("arguments_invalid");int prefix=IntPtr.Size==8?20:12;byte[] name=System.Text.Encoding.Unicode.GetBytes(target);int size=checked(prefix+name.Length+2);IntPtr value=Marshal.AllocHGlobal(size);
      try {
        for(int index=0;index<size;index++)Marshal.WriteByte(value,index,0);Marshal.WriteByte(value,0,0);Marshal.WriteIntPtr(value,IntPtr.Size==8?8:4,directory.DangerousGetHandle());
        Marshal.WriteInt32(value,IntPtr.Size==8?16:8,name.Length);Marshal.Copy(name,0,IntPtr.Add(value,prefix),name.Length);IoStatus status;
        int result=NtSetInformationFile(handle,out status,value,(uint)size,FileRenameInformation);if(result!=0)Fail("rename_failed_"+result.ToString("x8"));
      } finally {Marshal.FreeHGlobal(value);}
    }
    static string FlushDirectory(SafeFileHandle directory) {
      if(FlushFileBuffers(directory))return "SUPPORTED_SUCCEEDED";int error=Marshal.GetLastWin32Error();
      if(error==1||error==5||error==6||error==50||error==87)return "UNSUPPORTED";Fail("directory_flush_failed");return null;
    }
    static Dictionary<string,object> DirectoryProof(Info info,string sid,string flush) { return new Dictionary<string,object>{
      {"volumeSerial",info.Volume.ToString("x8")},{"fileId",info.Id.ToString("x16")},{"ownerSid",sid},{"protectedAcl",true},{"ntfs",true},{"reparse",false},{"flush",flush}}; }
    static Dictionary<string,object> FileProof(string name,long bytes,string sha,Info info,string sid) { return new Dictionary<string,object>{
      {"name",name},{"bytes",bytes},{"sha256",sha},{"fileId",info.Id.ToString("x16")},{"ownerSid",sid},{"protectedAcl",true},{"nlink",1}}; }
    static Dictionary<string,object> Proof(string state,Info directory,string sid,string flush,Dictionary<string,object> tar,Dictionary<string,object> sidecar=null) {
      var proof=new Dictionary<string,object>{{"kind","SCANNER_RETENTION_PRIVATE_COPY_V1"},{"state",state},{"directory",DirectoryProof(directory,sid,flush)},{"tar",tar}};
      if(sidecar!=null)proof.Add("sidecar",sidecar);return proof;
    }

    sealed class RestoreRecord {
      public readonly string Path,Sha256;public readonly long Bytes;
      public RestoreRecord(string path,long bytes,string sha256){Path=path;Bytes=bytes;Sha256=sha256;}
    }
    static List<RestoreRecord> ParseRestoreManifest(byte[] bytes) {
      var records=new List<RestoreRecord>();using(var document=JsonDocument.Parse(bytes,new JsonDocumentOptions{AllowTrailingCommas=false,CommentHandling=JsonCommentHandling.Disallow,MaxDepth=32})) {
        JsonElement root=document.RootElement,files=default(JsonElement);if(root.ValueKind!=JsonValueKind.Object||!root.TryGetProperty("files",out files)||files.ValueKind!=JsonValueKind.Array||files.GetArrayLength()!=RestorePaths.Length)Fail("manifest_invalid");
        int index=0;var seen=new HashSet<string>(StringComparer.Ordinal);foreach(JsonElement file in files.EnumerateArray()) {
          JsonElement pathValue=default(JsonElement),bytesValue=default(JsonElement),shaValue=default(JsonElement),classValue=default(JsonElement);long size=0;string path,sha;
          if(file.ValueKind!=JsonValueKind.Object||!file.TryGetProperty("path",out pathValue)||pathValue.ValueKind!=JsonValueKind.String
            ||!file.TryGetProperty("class",out classValue)||classValue.ValueKind!=JsonValueKind.String||String.IsNullOrEmpty(classValue.GetString())
            ||!file.TryGetProperty("bytes",out bytesValue)||!bytesValue.TryGetInt64(out size)||size<0||size>TarCap
            ||!file.TryGetProperty("sha256",out shaValue)||shaValue.ValueKind!=JsonValueKind.String)Fail("manifest_invalid");
          path=pathValue.GetString();sha=shaValue.GetString();if(path!=RestorePaths[index])Fail("manifest_invalid_path_"+index.ToString());index++;
          if(!seen.Add(path)||!Hex(sha,64))Fail("manifest_invalid");records.Add(new RestoreRecord(path,size,sha));
        }
      }
      return records;
    }
    static SafeFileHandle RelativeRestore(SafeFileHandle parent,string leaf,uint access,uint share,bool directory,string sid) {
      if(!RestoreLeaf(leaf))Fail("manifest_invalid");return Relative(parent,leaf,access,share,directory,false,sid);
    }
    static Info ValidateRestorePath(SafeFileHandle restore,string relative,long bytes,string sha,string sid) {
      string[] parts=relative.Split('/');if(parts.Length<2)Fail("manifest_invalid");var directories=new List<SafeFileHandle>();SafeFileHandle current=restore;
      try {
        for(int index=0;index<parts.Length-1;index++){var next=RelativeRestore(current,parts[index],ReadAttributes|ReadControl|WriteDac|WriteOwner|Sync,ShareRead|ShareWrite,true,sid);Information(next,true);Protect(next,sid,true);directories.Add(next);current=next;}
        using(var file=RelativeRestore(current,parts[parts.Length-1],Read|WriteDac|WriteOwner|Sync,0,false,sid)) {
          Info before=Information(file,false);if(before.Size!=bytes)Fail("bytes_invalid");Protect(file,sid,false);
          using(var stream=BorrowedStream(file,FileAccess.Read))if(Hash(stream)!=sha)Fail("bytes_invalid");
          if(!Stable(before,Information(file,false)))Fail("identity_changed");Security(file,sid,false);return before;
        }
      } finally {for(int index=directories.Count-1;index>=0;index--)directories[index].Dispose();}
    }
    static HashSet<string> Inventory(string root) {
      var result=new HashSet<string>(StringComparer.Ordinal);var pending=new Stack<string>();pending.Push(root);
      while(pending.Count>0){string current=pending.Pop();foreach(string entry in Directory.GetFileSystemEntries(current)) {
        var info=new FileInfo(entry);if((info.Attributes&FileAttributes.ReparsePoint)!=0)Fail("identity_invalid");string relative=Path.GetRelativePath(root,entry).Replace('\\','/');if(!result.Add(relative))Fail("identity_invalid");
        if((info.Attributes&FileAttributes.Directory)!=0)pending.Push(entry);
      }}return result;
    }
    static HashSet<string> ExpectedRestoreInventory() {
      var expected=new HashSet<string>(RestorePaths,StringComparer.Ordinal){RestoreManifestPath};var directories=new HashSet<string>(StringComparer.Ordinal);
      foreach(string file in expected){string[] parts=file.Split('/');string partial="";for(int index=0;index<parts.Length-1;index++){partial=partial.Length==0?parts[index]:partial+"/"+parts[index];directories.Add(partial);}}
      expected.UnionWith(directories);return expected;
    }
    static long ValidateRestoredTree(SafeFileHandle output,byte[] manifest,string manifestSha256,long manifestBytes,string sid) {
      List<RestoreRecord> records=ParseRestoreManifest(manifest);long total=manifestBytes;ValidateRestorePath(output,RestoreManifestPath,manifestBytes,manifestSha256,sid);
      foreach(RestoreRecord record in records){ValidateRestorePath(output,record.Path,record.Bytes,record.Sha256,sid);total=checked(total+record.Bytes);if(total>468322405)Fail("bytes_invalid");}
      if(!Inventory(FinalPath(output)).SetEquals(ExpectedRestoreInventory()))Fail("inventory_invalid");return total;
    }
    static void Disposition(SafeFileHandle handle) {
      IntPtr value=Marshal.AllocHGlobal(1);try{Marshal.WriteByte(value,0,1);IoStatus status;int result=NtSetInformationFile(handle,out status,value,1,FileDispositionInformation);if(result!=0)Fail("cleanup_failed_"+result.ToString("x8"));}
      finally{Marshal.FreeHGlobal(value);}
    }
    static SafeFileHandle OpenRestoreParent(SafeFileHandle root,string relative,string sid,List<SafeFileHandle> opened,out string leaf) {
      string[] parts=relative.Split('/');if(parts.Length<1)Fail("manifest_invalid");SafeFileHandle current=root;
      for(int index=0;index<parts.Length-1;index++){var next=RelativeRestore(current,parts[index],ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,true,sid);Information(next,true);Security(next,sid,true);opened.Add(next);current=next;}
      leaf=parts[parts.Length-1];return current;
    }
    static void DeleteRestorePath(SafeFileHandle root,string relative,bool directory,string sid,long bytes=0,string sha=null) {
      var opened=new List<SafeFileHandle>();try {
        string leaf;SafeFileHandle parent=OpenRestoreParent(root,relative,sid,opened,out leaf);
        if(directory)using(var inspect=RelativeRestore(parent,leaf,ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,true,sid)) {
          Information(inspect,true);Security(inspect,sid,true);if(Inventory(FinalPath(inspect)).Count!=0)Fail("cleanup_failed_not_empty");
        }
        using(var target=RelativeRestore(parent,leaf,(directory?ReadAttributes:Read)|ReadControl|Delete|Sync,0,directory,sid)) {
          if(directory){Information(target,true);Security(target,sid,true);}
          else ValidateFile(target,bytes,sha,sid,null);
          Disposition(target);
        }
      } finally {for(int index=opened.Count-1;index>=0;index--)opened[index].Dispose();}
    }

    public static Dictionary<string,object> InspectRestore(Configuration config,string phase,Stream input,string innerTarSha256,string nonce,string manifestSha256,long manifestBytes,
      string volumeSerial=null,string directoryFileId=null) {
      if(phase!="EMPTY"&&phase!="SEALED"||!Hex(innerTarSha256,64)||!Hex(nonce,32)||!Hex(manifestSha256,64)||manifestBytes<1||manifestBytes>2097152
        ||(phase=="EMPTY"?(!String.IsNullOrEmpty(volumeSerial)||!String.IsNullOrEmpty(directoryFileId)):(!Hex(volumeSerial,8)||!Hex(directoryFileId,16))))Fail("arguments_invalid");
      string name="restore-"+innerTarSha256+"-"+nonce;using(var guard=new Guard(config)) {
        guard.Check();SafeFileHandle restore=Relative(guard.Root,config.Directory,Write|ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,true,false,config.Sid,true);
        if(restore==null)Fail("open_failed");
        using(restore) {
          Security(restore,config.Sid,true);SafeFileHandle output=Relative(restore,name,Write|ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,true,phase=="EMPTY",config.Sid);
          using(output) {
            Info directory=Information(output,true);Security(output,config.Sid,true);guard.Check();
            if(phase=="EMPTY") {
              if(input.ReadByte()!=-1||Inventory(FinalPath(output)).Count!=0)Fail("bytes_invalid");
              return new Dictionary<string,object>{{"kind","SCANNER_RETENTION_RESTORE_INSPECTION_V1"},{"phase","EMPTY"},{"directory",DirectoryProof(directory,config.Sid,"NOT_ATTEMPTED")},{"files",0},{"bytes",0}};
            }
            RequireIdentity(directory,volumeSerial,directoryFileId);byte[] manifest=ReadExact(input,manifestBytes,manifestSha256,2097152);long total=ValidateRestoredTree(output,manifest,manifestSha256,manifestBytes,config.Sid);
            directory=Information(output,true);RequireIdentity(directory,volumeSerial,directoryFileId);Security(output,config.Sid,true);guard.Check();
            return new Dictionary<string,object>{{"kind","SCANNER_RETENTION_RESTORE_INSPECTION_V1"},{"phase","SEALED"},{"directory",DirectoryProof(directory,config.Sid,"NOT_ATTEMPTED")},
              {"manifest",new Dictionary<string,object>{{"path",RestoreManifestPath},{"bytes",manifestBytes},{"sha256",manifestSha256}}},{"files",50},{"bytes",total}};
          }
        }
      }
    }

    public static Dictionary<string,object> CleanupRestore(Configuration config,Stream input,string innerTarSha256,string nonce,string manifestSha256,long manifestBytes,string volumeSerial,string directoryFileId) {
      if(!Hex(innerTarSha256,64)||!Hex(nonce,32)||!Hex(manifestSha256,64)||manifestBytes<1||manifestBytes>2097152||!Hex(volumeSerial,8)||!Hex(directoryFileId,16))Fail("arguments_invalid");
      byte[] manifest=ReadExact(input,manifestBytes,manifestSha256,2097152);List<RestoreRecord> records=ParseRestoreManifest(manifest);string name="restore-"+innerTarSha256+"-"+nonce;
      using(var guard=new Guard(config))using(var scanner=Relative(guard.Root,config.Directory,Write|ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,true,false,config.Sid)) {
        Security(scanner,config.Sid,true);Info observed;
        using(var output=Relative(scanner,name,Write|ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,true,false,config.Sid)) {
          observed=Information(output,true);RequireIdentity(observed,volumeSerial,directoryFileId);Security(output,config.Sid,true);ValidateRestoredTree(output,manifest,manifestSha256,manifestBytes,config.Sid);
          foreach(RestoreRecord record in records)DeleteRestorePath(output,record.Path,false,config.Sid,record.Bytes,record.Sha256);
          DeleteRestorePath(output,RestoreManifestPath,false,config.Sid,manifestBytes,manifestSha256);
          var filePaths=new HashSet<string>(RestorePaths,StringComparer.Ordinal){RestoreManifestPath};var directories=new List<string>();foreach(string entry in ExpectedRestoreInventory())if(!filePaths.Contains(entry))directories.Add(entry);
          directories.Sort((left,right)=>{int depth=right.Split('/').Length.CompareTo(left.Split('/').Length);return depth!=0?depth:StringComparer.Ordinal.Compare(right,left);});
          foreach(string directory in directories)DeleteRestorePath(output,directory,true,config.Sid);
          if(Inventory(FinalPath(output)).Count!=0)Fail("cleanup_failed_not_empty");
        }
        using(var output=Relative(scanner,name,ReadAttributes|ReadControl|Delete|Sync,0,true,false,config.Sid)) {
          Info current=Information(output,true);RequireIdentity(current,volumeSerial,directoryFileId);Security(output,config.Sid,true);Disposition(output);
        }
        guard.Check();return new Dictionary<string,object>{{"kind","SCANNER_RETENTION_RESTORE_INSPECTION_V1"},{"phase","CLEANED"},
          {"directory",new Dictionary<string,object>{{"volumeSerial",volumeSerial},{"fileId",directoryFileId}}},{"files",50},{"state","REMOVED"}};
      }
    }

    public static Dictionary<string,object> Execute(Configuration config,string operation,Stream input,Stream output,string innerTarSha256,long innerTarBytes,
      string volumeSerial=null,string directoryFileId=null,string tarFileId=null,string sidecarSha256=null,long sidecarBytes=0,string sidecarFileId=null) {
      if(operation!="StageTar"&&operation!="CommitPair"&&operation!="InspectPair"&&operation!="ExportTar"||!Hex(innerTarSha256,64)||innerTarBytes<1||innerTarBytes>TarCap)Fail("arguments_invalid");
      bool stage=operation=="StageTar",commit=operation=="CommitPair",pair=operation=="InspectPair"||operation=="ExportTar";
      if(stage?(!String.IsNullOrEmpty(volumeSerial)||!String.IsNullOrEmpty(directoryFileId)||!String.IsNullOrEmpty(tarFileId)||!String.IsNullOrEmpty(sidecarSha256)||sidecarBytes!=0||!String.IsNullOrEmpty(sidecarFileId))
        :(!Hex(volumeSerial,8)||!Hex(directoryFileId,16)||!Hex(tarFileId,16)||!Hex(sidecarSha256,64)||sidecarBytes<1||sidecarBytes>SidecarCap||pair&&!Hex(sidecarFileId,16)||commit&&!String.IsNullOrEmpty(sidecarFileId)))Fail("arguments_invalid");
      using(var guard=new Guard(config))using(var directory=ScannerDirectory(guard,stage)) {
        Info directoryInfo=Information(directory,true);Security(directory,config.Sid,true);guard.Check();
        string tarPart=TarName(innerTarSha256,true),tarFinal=TarName(innerTarSha256,false),sidecarPart=SidecarName(innerTarSha256,true),sidecarFinal=SidecarName(innerTarSha256,false);
        if(stage) {
          Info tar=WriteExact(directory,tarPart,innerTarBytes,innerTarSha256,config.Sid,input);directoryInfo=Information(directory,true);
          return Proof("STAGED",directoryInfo,config.Sid,"NOT_ATTEMPTED",FileProof(tarPart,innerTarBytes,innerTarSha256,tar,config.Sid));
        }
        RequireIdentity(directoryInfo,volumeSerial,directoryFileId);
        if(commit) {
          byte[] sidecar=ReadExact(input,sidecarBytes,sidecarSha256);Info tar,sidecarInfo;
          using(var tarHandle=Relative(directory,tarPart,Read|Delete|Sync,0,false,false,config.Sid)) {
            tar=ValidateFile(tarHandle,innerTarBytes,innerTarSha256,config.Sid,null);RequireIdentity(tar,volumeSerial,tarFileId);
            using(var sidecarInput=new MemoryStream(sidecar,false))sidecarInfo=WriteExact(directory,sidecarPart,sidecarBytes,sidecarSha256,config.Sid,sidecarInput);
            RequireAbsent(directory,tarFinal,config.Sid);RequireAbsent(directory,sidecarFinal,config.Sid);
            RenameNoReplace(tarHandle,directory,tarFinal);if(!String.Equals(FinalPath(tarHandle),"\\\\?\\"+config.Root+"\\"+config.Directory+"\\"+tarFinal,StringComparison.OrdinalIgnoreCase))Fail("identity_changed");
            string firstFlush=FlushDirectory(directory);
            using(var sidecarHandle=Relative(directory,sidecarPart,Read|Delete|Sync,0,false,false,config.Sid)) {
              Info reopened=ValidateFile(sidecarHandle,sidecarBytes,sidecarSha256,config.Sid,null,sidecar);if(reopened.Id!=sidecarInfo.Id||reopened.Volume!=sidecarInfo.Volume)Fail("identity_changed");
              RenameNoReplace(sidecarHandle,directory,sidecarFinal);if(!String.Equals(FinalPath(sidecarHandle),"\\\\?\\"+config.Root+"\\"+config.Directory+"\\"+sidecarFinal,StringComparison.OrdinalIgnoreCase))Fail("identity_changed");
              string secondFlush=FlushDirectory(directory);string flush=firstFlush=="SUPPORTED_SUCCEEDED"&&secondFlush=="SUPPORTED_SUCCEEDED"?"SUPPORTED_SUCCEEDED":"UNSUPPORTED";
              Info finalTar=Information(tarHandle,false),finalSidecar=Information(sidecarHandle,false);RequireIdentity(finalTar,volumeSerial,tarFileId);
              if(finalSidecar.Id!=sidecarInfo.Id||finalSidecar.Volume!=sidecarInfo.Volume)Fail("identity_changed");directoryInfo=Information(directory,true);RequireIdentity(directoryInfo,volumeSerial,directoryFileId);
              return Proof("COMMITTED",directoryInfo,config.Sid,flush,FileProof(tarFinal,innerTarBytes,innerTarSha256,finalTar,config.Sid),FileProof(sidecarFinal,sidecarBytes,sidecarSha256,finalSidecar,config.Sid));
            }
          }
        }
        byte[] expectedSidecar=null;
        if(operation=="InspectPair")expectedSidecar=ReadExact(input,sidecarBytes,sidecarSha256);
        else if(input.ReadByte()!=-1)Fail("bytes_invalid");
        using(var tarHandle=Relative(directory,tarFinal,Read|Sync,0,false,false,config.Sid))using(var sidecarHandle=Relative(directory,sidecarFinal,Read|Sync,0,false,false,config.Sid)) {
          Info sidecar=ValidateFile(sidecarHandle,sidecarBytes,sidecarSha256,config.Sid,null,expectedSidecar);RequireIdentity(sidecar,volumeSerial,sidecarFileId);
          Info tar=ValidateFile(tarHandle,innerTarBytes,innerTarSha256,config.Sid,operation=="ExportTar"?output:null);RequireIdentity(tar,volumeSerial,tarFileId);
          directoryInfo=Information(directory,true);RequireIdentity(directoryInfo,volumeSerial,directoryFileId);guard.Check();Security(directory,config.Sid,true);
          if(operation=="ExportTar")return null;
          return Proof("INSPECTED",directoryInfo,config.Sid,"NOT_ATTEMPTED",FileProof(tarFinal,innerTarBytes,innerTarSha256,tar,config.Sid),FileProof(sidecarFinal,sidecarBytes,sidecarSha256,sidecar,config.Sid));
        }
      }
    }
  }
}
