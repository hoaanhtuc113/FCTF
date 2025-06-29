using Newtonsoft.Json.Converters;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.Models
{
    public class K8sDeploymentDefinition
    {
        public string ApiVersion { get; set; } = string.Empty;
        public string Kind { get; set; } = string.Empty;
        public Metadata Metadata { get; set; } = new Metadata();
        public Spec Spec { get; set; } = new Spec();
    }

    public class Metadata
    {
        public string Name { get; set; } = string.Empty;
    }

    public class Spec
    {
        public int Replicas { get; set; } = 0;
        public Selector Selector { get; set; } = new Selector();
        public Template Template { get; set; } = new Template();
    }

    public class Selector
    {
        public MatchLabels MatchLabels { get; set; } = new MatchLabels();
    }

    public class MatchLabels
    {
        public string App { get; set; } = string.Empty;
    }

    public class Template
    {
        public TemplateMetadata Metadata { get; set; } = new TemplateMetadata();
        public TemplateSpec Spec { get; set; } = new TemplateSpec();
    }

    public class TemplateMetadata
    {
        public TemplateLabels Labels { get; set; } = new TemplateLabels();
    }

    public class TemplateLabels
    {
        public string App { get; set; } = string.Empty;
    }

    public class TemplateSpec
    {
        public List<Container> Containers { get; set; } = new List<Container>();
    }

    public class Container
    {
        public string Name { get; set; } = string.Empty;
        public string Image { get; set; } = string.Empty;
        public List<EnvironmentVariable> Env { get; set; } = new List<EnvironmentVariable>();
        public List<Port> Ports { get; set; } = new List<Port>();

        public Resource Resources { get; set; } = new Resource();

    }

    public class Resource
    {
        public Limits Limits { get; set; } = new Limits();
        public Requests Requests { get; set; } = new Requests();
    }

    public class Requests
    {
        public string Cpu { get; set; } = string.Empty;
        public string Memory { get; set; } = string.Empty;
    }

    public class Limits
    {
        public string Cpu { get; set; } = string.Empty;
        public string Memory { get; set; } = string.Empty;
    }

    public class EnvironmentVariable
    {
        public string Name { get; set; } = string.Empty;
        public string Value { get; set; } = string.Empty;
    }

    public class Port
    {
        public int ContainerPort { get; set; } = 0;
    }

}